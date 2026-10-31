"""GridScope energy monitor with Wi-Fi and USB serial telemetry."""
from __future__ import annotations
import argparse
import csv
import io
import json
import math
import os
import sqlite3
import threading
import time
from collections import deque
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.request import ProxyHandler, build_opener
from urllib.parse import urlparse

from cloud import CloudStore
from energy_math import Settings, derive, energy_increment_wh, parse_data, tariff_details, within_quiet_hours

ROOT = Path(__file__).resolve().parent
DB = ROOT / "energy.sqlite3"
CONFIG = ROOT / "config.json"
DEFAULTS = asdict(Settings())


@contextmanager
def db_connection():
    conn = sqlite3.connect(DB, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db_connection() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS samples (
            timestamp REAL PRIMARY KEY, main_ma REAL, branch_a_ma REAL,
            branch_b_ma REAL, main_w REAL, branch_a_w REAL, branch_b_w REAL,
            wh_total REAL, wh_a REAL, wh_b REAL, residual_ma REAL,
            flags TEXT, data_mode TEXT, raw_main_ma REAL, raw_branch_ma REAL,
            noise_main_ma REAL, noise_branch_ma REAL, idle_valid INTEGER,
            clipping INTEGER, sample_window_ms REAL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp REAL, kind TEXT,
            title TEXT, details TEXT, data_mode TEXT
        )""")


def load_settings() -> Settings:
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps(DEFAULTS, indent=2) + "\n", encoding="utf8")
    return Settings.parse(json.loads(CONFIG.read_text(encoding="utf8")))


class EnergyEngine:
    def __init__(self, mode: str = "LIVE"):
        init_db()
        self.cloud = CloudStore()
        self.lock = threading.RLock()
        self.settings = load_settings()
        self.mode = mode
        self.port: str | None = None
        self.transport = "USB serial"
        self.network_packet_id = None
        self.scan = {"phase": "Not started", "ranges": [], "ports": [], "attempted": 0, "total": 0, "results": [], "round": 0}
        self.device_health = None
        self.serial_device: Any = None
        self.connection_status = "CONNECTING" if mode == "LIVE" else "SIMULATION"
        self.error = ""
        self.calibration_status = "NOT_REQUESTED"
        self.last_line = ""
        self.latest: dict | None = None
        self.last_packet_wall: float | None = None
        self.last_packet_mono: float | None = None
        self.last_recorded_wall = 0.0
        self.events = deque(maxlen=40)
        self.last_alert_at: dict[str, float] = {}
        self.alert_hits: dict[str, int] = {}
        self.previous_power: dict | None = None
        # Exactly the current project's server-side 8-sample moving average.
        self._avg_main = deque([0.0] * 8, maxlen=8)
        self._avg_branch = deque([0.0] * 8, maxlen=8)
        self.legacy_noise_floor_ma = 20.0  # original app.py, still used after firmware cutoff
        self.total_wh = self.a_wh = self.b_wh = 0.0
        with db_connection() as conn:
            r = conn.execute("SELECT wh_total,wh_a,wh_b FROM samples WHERE data_mode=? ORDER BY timestamp DESC LIMIT 1", (self.mode,)).fetchone()
            if r:
                self.total_wh, self.a_wh, self.b_wh = (r["wh_total"], r["wh_a"], r["wh_b"])

    def log_event(self, kind: str, title: str, details: str):
        now = time.time()
        event = {"timestamp": now, "kind": kind, "title": title, "details": details}
        self.events.appendleft(event)
        with db_connection() as conn:
            conn.execute("INSERT INTO events(timestamp,kind,title,details,data_mode) VALUES (?,?,?,?,?)",
                         (now, kind, title, details, self.mode))
        self.cloud.push("events", {"ts": now, "kind": kind, "title": title, "details": details, "mode": self.mode})

    def receive_info(self, line: str):
        with self.lock:
            self.last_line = line[:260]
            if line.startswith("CAL:IDLE_DONE"):
                self.calibration_status = "DONE"
                self.log_event("success", "Idle calibration complete", "Both sensor baselines and idle noise captured")
            elif line.startswith("CAL:IDLE_REJECTED"):
                self.calibration_status = "REJECTED"
                self.log_event("warning", "Idle calibration rejected", line[:210])
            elif line.startswith("CAL:IDLE_START"):
                self.calibration_status = "IN_PROGRESS"
            elif line.startswith("WARN:"):
                self.log_event("warning", "Firmware warning", line[:210])
            elif line.startswith("ERR:"):
                self.error = line
                self.log_event("error", "Firmware error", line[:210])

    def _alert(self, name: str, active: bool, title: str, details: str):
        self.alert_hits[name] = self.alert_hits.get(name, 0) + 1 if active else 0
        now = time.time()
        if self.alert_hits[name] >= 4 and now - self.last_alert_at.get(name, 0) > 90:
            self.last_alert_at[name] = now
            self.log_event("warning", title, details)

    def accept(self, packet: dict[str, float]):
        # Preserve the original dotted-board firmware as-is. Its DATA line
        # already carries calibrated-and-noise-filtered current, not raw ADC.
        # Retain the old Flask eight-sample smoothing and 20mA soft floor.
        if "s1_raw_mA" not in packet:  # firmware from Parth0014/Sensor master
            with self.lock:
                original_main = packet["s1_mA"]
                original_branch = packet["s2_mA"]
                self._avg_main.append(original_main)
                self._avg_branch.append(original_branch)
                main_ma = sum(self._avg_main) / len(self._avg_main)
                branch_ma = sum(self._avg_branch) / len(self._avg_branch)
                main_ma = main_ma if main_ma >= self.legacy_noise_floor_ma else 0.0
                branch_ma = branch_ma if branch_ma >= self.legacy_noise_floor_ma else 0.0
                # Original app.py behavior: if main is reported zero, the
                # downstream branch is displayed as zero. Retain for
                # compatibility, BUT flag the substitution and preserve
                # the actual incoming firmware current in diagnostics.
                clamped = main_ma == 0.0 and branch_ma != 0.0
                if main_ma == 0.0:
                    branch_ma = 0.0
                packet = {**packet, "s1_mA": main_ma, "s2_mA": branch_ma,
                    "s1_transmitted_mA": original_main,
                    "s2_transmitted_mA": original_branch,
                    "legacy_zero_clamped": 1 if clamped else 0}
        reading = derive(packet, self.settings)
        now = time.time()
        mono = time.monotonic()
        with self.lock:
            dt = mono - self.last_packet_mono if self.last_packet_mono is not None else 0
            # Integrate from real elapsed time; never multiply nominal samples by fixed intervals.
            if self.previous_power and reading["valid_for_energy"]:
                self.total_wh += energy_increment_wh(self.previous_power["main_w"], reading["main_w"], dt)
                self.a_wh += energy_increment_wh(self.previous_power["branch_a_w"], reading["branch_a_w"], dt)
                if self.previous_power["branch_b_w"] is not None and reading["branch_b_w"] is not None:
                    self.b_wh += energy_increment_wh(self.previous_power["branch_b_w"], reading["branch_b_w"], dt)
            self.previous_power = reading if reading["valid_for_energy"] else None
            self.last_packet_mono = mono
            self.last_packet_wall = now
            reading["timestamp"] = now
            self.latest = reading
            self.error = ""
            self.connection_status = "SIMULATION" if self.mode == "DEMO" else "CONNECTED"
            quiet = within_quiet_hours(datetime.fromtimestamp(now).hour,
                                       self.settings.quiet_start_hour, self.settings.quiet_end_hour)
            if self.mode == "LIVE":
                self._alert("demand", reading["main_w"] >= self.settings.peak_demand_w,
                            "Peak demand threshold", f"Estimated {reading['main_w']:.1f} W > {self.settings.peak_demand_w:.1f} W")
                self._alert("after_hours", quiet and reading["main_ma"] >= self.settings.active_current_ma,
                            "Consumption outside operating hours", "Main feeder remains active during configured quiet hours")
                self._alert("mismatch", any(f.startswith("METER_MISMATCH") for f in reading["flags"]),
                            "Sensor disagreement", f"Branch > main feeder, residual {reading['signed_residual_ma']:.1f} mA")
                self._alert("clipped", not reading["valid_for_energy"],
                            "ADC saturation", "Input waveform is clipped; energy integration skipped")
            # Sample 1 row/second, but calculate energy at each incoming packet.
            if now - self.last_recorded_wall >= 1:
                self.last_recorded_wall = now
                with db_connection() as conn:
                    conn.execute("""INSERT OR REPLACE INTO samples
                        (timestamp,main_ma,branch_a_ma,branch_b_ma,main_w,branch_a_w,branch_b_w,
                         wh_total,wh_a,wh_b,residual_ma,flags,data_mode,
                         raw_main_ma,raw_branch_ma,noise_main_ma,noise_branch_ma,idle_valid,clipping,sample_window_ms)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                         (now,reading["main_ma"],reading["branch_a_ma"],reading["branch_b_ma"],
                          reading["main_w"],reading["branch_a_w"],reading["branch_b_w"],
                          self.total_wh,self.a_wh,self.b_wh,reading["signed_residual_ma"],
                          json.dumps(reading["flags"]),self.mode,reading["raw_main_ma"],
                          reading["raw_branch_ma"],reading["sensor_noise_main_ma"],reading["sensor_noise_branch_ma"],
                          None if reading["idle_calibrated"] is None else int(reading["idle_calibrated"]),
                          int(not reading["valid_for_energy"]),reading["sample_window_ms"]))
                self.cloud.push("samples", {"ts": now, "mode": self.mode, "main_ma": reading["main_ma"],
                    "main_w": reading["main_w"], "a_w": reading["branch_a_w"], "b_w": reading["branch_b_w"],
                    "residual_ma": reading["signed_residual_ma"], "wh_total": self.total_wh, "wh_a": self.a_wh,
                    "wh_b": self.b_wh, "cost_inr": self.total_wh / 1000 * self.settings.tariff_inr_per_kwh,
                    "flags": reading["flags"]})

    def dashboard(self) -> dict:
        st = self.state()
        c = self.cloud
        st["cloud"] = {"enabled": c.enabled, "ok": c.ok, "queued": c.queued, "synced": c.synced}
        st["source"] = "local"
        if c.ok:
            try:
                h = c.history(180, self.mode)
                if h:
                    last = h[-1]
                    st["history"] = [{"timestamp": r["ts"], "main_w": r["main_w"], "branch_a_w": r["a_w"],
                                      "branch_b_w": r["b_w"], "residual_ma": r["residual_ma"]} for r in h]
                    st["totals"] = {"total_wh": last["wh_total"], "a_wh": last["wh_a"], "b_wh": last["wh_b"],
                                    "cost_inr": round(last["wh_total"] / 1000 * self.settings.tariff_inr_per_kwh, 5)}
                    st["events"] = [{"timestamp": e["ts"], "kind": e["kind"], "title": e["title"],
                                     "details": e["details"]} for e in c.recent_events(25, self.mode)]
                    st["source"] = "mongodb"
            except Exception as e:
                c.ok = False; st["cloud"]["ok"] = False
        return st

    def state(self) -> dict:
        with self.lock:
            age = time.time() - self.last_packet_wall if self.last_packet_wall else None
            live = age is not None and age < 4 and self.connection_status in ("CONNECTED", "SIMULATION")
            if self.mode == "DEMO":
                connection = "SIMULATION" if live else "WAITING"
            else:
                connection = "CONNECTED" if live else "DISCONNECTED"
            with db_connection() as conn:
                history = [dict(r) for r in conn.execute("""SELECT timestamp,main_w,branch_a_w,
                 branch_b_w,residual_ma FROM samples WHERE data_mode=? ORDER BY timestamp DESC LIMIT 120""", (self.mode,))]
                recent_events = [dict(r) for r in conn.execute("SELECT timestamp,kind,title,details FROM events WHERE data_mode=? ORDER BY id DESC LIMIT 20", (self.mode,))]
            return {
                "mode": self.mode, "connection": connection, "port": self.port,
                "transport": self.transport,
                "scan": {**self.scan, "results": list(self.scan["results"])},
                "device_health": self.device_health,
                "last_packet": self.last_line,
                "age_seconds": round(age, 2) if age is not None else None,
                "latest": self.latest if live else None,
                "last_known": self.latest if not live else None,
                "totals": {"total_wh": round(self.total_wh, 5), "a_wh": round(self.a_wh, 5),
                           "b_wh": round(self.b_wh, 5),
                           "cost_inr": round(self.total_wh / 1000 * self.settings.tariff_inr_per_kwh, 5)},
                "settings": asdict(self.settings), "tariff": tariff_details(self.settings.tariff_inr_per_kwh), "events": recent_events,
                "history": list(reversed(history)), "error": self.error,
                "calibration_status": ("AUTO_ON_FIRMWARE_BOOT" if (self.latest and self.latest["firmware"] == "legacy") else self.calibration_status),
                "firmware_compatibility": "Original dotted-board firmware: no reflashing needed",
            }

    def update_settings(self, changes: dict) -> dict:
        with self.lock:
            combined = {**asdict(self.settings), **changes}
            if any(k not in DEFAULTS for k in changes):
                raise ValueError("Unknown setting key")
            updated = Settings.parse(combined)
            tmp = CONFIG.with_suffix(".tmp")
            tmp.write_text(json.dumps(asdict(updated), indent=2) + "\n", encoding="utf8")
            os.replace(tmp, CONFIG)
            self.settings = updated
            self.log_event("info", "Settings updated", "Configured estimates/calibration; historical records not retroactively recalculated")
            return asdict(updated)

    def request_idle_calibration(self) -> bool:
        # Deliberately don't send CAL:IDLE to legacy firmware: that command
        # was not implemented in the original dotted-board sketch.
        if self.latest and self.latest.get("firmware") == "legacy":
            return False
        with self.lock:
            if self.mode != "LIVE" or self.serial_device is None or not self.serial_device.is_open:
                return False
            self.serial_device.write(b"CAL:IDLE\n")
            self.calibration_status = "REQUESTED"
            return True


def serial_reader(engine: EnergyEngine, port: str | None):
    try:
        import serial
        from serial.tools import list_ports
    except ImportError:
        engine.error = "pyserial is not installed. Run pip install -r requirements.txt"
        return
    while True:
        dev = port
        if not dev:
            candidates = list(list_ports.comports())
            scored = [p for p in candidates if any(x in ((p.description or "") + " " + (p.manufacturer or "")).lower()
                           for x in ("ch340", "cp210", "usb serial", "usb-serial", "esp", "uart"))]
            dev = (scored or candidates)[0].device if candidates else None
        if not dev:
            engine.connection_status = "DISCONNECTED"
            engine.error = "No serial port detected; pass --port COM3 or --port /dev/ttyUSB0"
            time.sleep(3)
            continue
        try:
            with serial.Serial(dev, 115200, timeout=1, write_timeout=2) as ser:
                with engine.lock:
                    engine.port = dev
                    engine.serial_device = ser
                    engine.connection_status = "WAITING_FOR_DATA"
                    engine.previous_power = None
                    engine.last_packet_mono = None
                while ser.is_open:
                    raw = ser.readline()
                    if not raw:
                        continue
                    line = raw.decode("utf8", errors="replace").strip()
                    if line.startswith("DATA,"):
                        payload = parse_data(line)
                        if payload is not None:
                            engine.accept(payload)
                        else:
                            engine.receive_info("WARN:Malformed DATA packet ignored")
                    elif line:
                        engine.receive_info(line)
        except (serial.SerialException, OSError) as exc:
            engine.error = f"Serial: {exc}"
            engine.connection_status = "DISCONNECTED"
        finally:
            with engine.lock:
                engine.serial_device = None
                engine.previous_power = None
                engine.last_packet_mono = None
        time.sleep(2)


def accept_network_packet(engine: EnergyEngine, body: bytes) -> bool:
    packet = parse_data(body.decode("utf8").strip())
    if packet is None or any(k not in packet or packet[k] < 0 or not packet[k].is_integer()
                             for k in ("boot", "seq")):
        raise ValueError("ESP response must be DATA telemetry with boot and seq fields")
    identity = (packet["boot"], packet["seq"])
    with engine.lock:
        engine.last_line = body.decode("utf8").strip()[:500]
        if identity == engine.network_packet_id:
            return False  # Re-reading a cached measurement must not refresh its age or energy.
        engine.transport = "Wi-Fi"
        engine.accept(packet)
        engine.network_packet_id = identity
    return True


def network_reader(engine: EnergyEngine, url: str | None = None):
    from network_scan import load_scan_config, read_health, scan_once
    engine.transport = "Wi-Fi"
    engine.port = url
    opener = build_opener(ProxyHandler({}))  # Hotspot traffic should never use an HTTP proxy.

    def report(update):
        with engine.lock:
            if "attempt" in update:
                engine.scan["attempted"] += 1
                engine.scan["results"] = (engine.scan["results"] + [update["attempt"]])[-60:]
            else:
                engine.scan.update(update)

    target = url
    failures = 0
    while True:
        try:
            if target is None:
                with engine.lock:
                    engine.port = None
                    engine.device_health = None
                    engine.scan["round"] += 1
                    engine.scan["results"] = []
                    engine.scan.update(phase="Preparing scan", attempted=0, total=0)
                    engine.error = "Scanning configured addresses and ports for your ESP8266."
                found = scan_once(load_scan_config(ROOT / "network_scan.json"), report)
                if found is None:
                    report({"phase": "No device found. Retrying in 3 seconds"})
                    raise ValueError("No GridScope response. Check hotspot access, or connect to GridScope-Setup Wi-Fi. See scan results below.")
                target = found["url"] + "/telemetry"
                with engine.lock:
                    engine.device_health = found["device"]
                failures = 0
            with engine.lock:
                engine.port = target
            report({"phase": "Device found"})
            # Health remains available even if the ADC is missing or calibrating.
            health = read_health(target.rsplit("/", 1)[0], 2)
            with engine.lock:
                engine.device_health = health
            if health.get("status") != "READY":
                raise ValueError("ESP reached: " + str(health.get("status", "Unknown sensor status")))
            with opener.open(target, timeout=2) as response:
                body = response.read(2049)
            if len(body) > 2048:
                raise ValueError("ESP response exceeds 2048 bytes")
            is_new = accept_network_packet(engine, body)
            if not is_new and engine.last_packet_wall and time.time() - engine.last_packet_wall >= 4:
                raise ValueError("ESP is responding but its sensor sample is not advancing")
            failures = 0
            report({"phase": "Receiving readings"})
        except (OSError, ValueError, UnicodeError) as exc:
            with engine.lock:
                engine.error = f"Wi-Fi: {exc}"
                engine.connection_status = "DISCONNECTED"
                engine.previous_power = None
                engine.last_packet_mono = None
            if isinstance(exc, OSError):
                failures += 1
                report({"phase": f"Connection failed ({failures}/3). Retrying"})
                if failures >= 3 and not url:
                    target = None
            elif target:
                report({"phase": "Device reached; check sensor status"})
        time.sleep(0.7 if target else 3)


def open_dashboard(web_port: int):
    """Wait for Flask before opening the local dashboard."""
    import webbrowser
    url = f"http://127.0.0.1:{web_port}"
    opener = build_opener(ProxyHandler({}))
    for _ in range(40):
        try:
            with opener.open(url + "/api/state", timeout=0.5) as response:
                if response.status == 200:
                    webbrowser.open(url)
                    return
        except OSError:
            pass
        time.sleep(0.25)


def demo_feeder(engine: EnergyEngine):
    """Synthetic data only with explicit --demo and persistent SIMULATION banner."""
    k = 0
    while True:
        state = (k // 15) % 4
        a = 175.0 if state in (1, 3) else 0.0
        b = 260.0 if state in (2, 3) else 0.0
        wiggle = 2.0 * math.sin(k * 0.4)
        packet = {"s1_mA": max(0, a + b + wiggle), "s2_mA": max(0, a + wiggle / 2),
                  "s1_raw_mA": max(0, a + b + wiggle + 1.8),
                  "s2_raw_mA": max(0, a + wiggle / 2 + 1.8),
                  "s1_noise_mA": 3.0, "s2_noise_mA": 3.0,
                  "idle_valid": 1, "clip": 0, "seq": k, "window_ms": 236}
        engine.accept(packet)
        k += 1
        time.sleep(1)


def create_app(engine: EnergyEngine) -> Flask:
    from flask import Flask, Response, jsonify, render_template, request
    app = Flask(__name__, template_folder=str(ROOT / "templates"), static_folder=str(ROOT / "static"))

    @app.get("/")
    def home():
        return render_template("index.html")

    @app.get("/api/state")
    def state():
        return jsonify(engine.state())

    @app.get("/api/dashboard")
    def dashboard():
        return jsonify(engine.dashboard())

    @app.post("/api/settings")
    def settings():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error="Expected JSON object"), 400
        try:
            return jsonify(settings=engine.update_settings(data))
        except (ValueError, TypeError) as exc:
            return jsonify(error=str(exc)), 400

    @app.post("/api/calibrate-idle")
    def calibrate():
        body = request.get_json(silent=True) or {}
        if body.get("both_bulbs_off") is not True:
            return jsonify(error="Confirm that BOTH physical bulbs are OFF before calibrating"), 400
        if not engine.request_idle_calibration():
            return jsonify(error="Legacy firmware does not support live recalibration. No flash required; calibration occurs on firmware boot."), 409
        return jsonify(ok=True, message="Idle calibration requested; confirmation pending from ESP8266")

    @app.get("/api/export.csv")
    def export_csv():
        s = io.StringIO()
        writer = csv.writer(s)
        with db_connection() as conn:
            rows = conn.execute("SELECT * FROM samples WHERE data_mode=? ORDER BY timestamp ASC", (engine.mode,))
            writer.writerow([x[0] for x in rows.description])
            for row in rows:
                writer.writerow(list(row))
        filename = "energy-monitor-simulation.csv" if engine.mode == "DEMO" else "energy-monitor.csv"
        return Response(s.getvalue(), mimetype="text/csv", headers={"Content-Disposition": f"attachment; filename={filename}"})

    return app


def main():
    parser = argparse.ArgumentParser(description="Soldered-board energy audit monitor")
    parser.add_argument("--port", help="Use USB serial instead of Wi-Fi scanning, e.g. COM3")
    parser.add_argument("--web-port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1", help="Set 0.0.0.0 to open on your LAN; protect the network")
    parser.add_argument("--demo", action="store_true", help="Explicit, clearly labeled simulated readings")
    parser.add_argument("--device-url", help="ESP8266 telemetry URL, e.g. http://192.168.43.20/telemetry")
    parser.add_argument("--open-browser", action="store_true", default=True, help="Open the dashboard automatically (default)")
    parser.add_argument("--no-browser", action="store_false", dest="open_browser", help="Do not open a browser")
    args = parser.parse_args()
    if sum((bool(args.port), args.demo, bool(args.device_url))) > 1:
        parser.error("Choose one of --port, --demo or --device-url")
    if args.device_url:
        u = urlparse(args.device_url)
        if u.scheme != "http" or not u.hostname or u.username or u.password:
            parser.error("--device-url must be an http:// ESP8266 address without credentials")
    engine = EnergyEngine("DEMO" if args.demo else "LIVE")
    from werkzeug.serving import make_server
    app = create_app(engine)
    http_server = None
    if not 1 <= args.web_port <= 65535:
        parser.error("--web-port must be between 1 and 65535")
    for web_port in range(args.web_port, min(args.web_port + 11, 65536)):
        try:
            http_server = make_server(args.host, web_port, app, threaded=True)
            break
        except (OSError, SystemExit):
            print(f"Dashboard port {web_port} unavailable; trying next port.")
    if http_server is None:
        parser.error("No available dashboard port in the requested 11-port range")
    target = demo_feeder if args.demo else serial_reader if args.port else network_reader
    kwargs = {"args": (engine,)} if args.demo else {"args": (engine, args.device_url or args.port)}
    threading.Thread(target=target, daemon=True, **kwargs).start()
    if args.open_browser:
        threading.Thread(target=open_dashboard, args=(http_server.server_port,), daemon=True).start()
    print(f"Energy Monitor ({engine.mode}) -> http://localhost:{http_server.server_port}")
    print("AC watt/kWh readings are estimates at configured voltage, not revenue-grade measurements.")
    try:
        http_server.serve_forever()
    finally:
        http_server.server_close()


if __name__ == "__main__":
    main()
