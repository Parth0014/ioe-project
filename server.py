"""GridScope energy monitor with USB serial telemetry."""
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

from cloud import CloudStore
from analytics import local_analytics, parameters, report
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
        conn.execute("CREATE INDEX IF NOT EXISTS samples_mode_time ON samples(data_mode,timestamp)")


def load_settings() -> Settings:
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps(DEFAULTS, indent=2) + "\n", encoding="utf8")
    return Settings.parse(json.loads(CONFIG.read_text(encoding="utf8")))


class EnergyEngine:
    def __init__(self, mode: str = "LIVE"):
        init_db()
        self.lock = threading.RLock()
        self.settings = load_settings()
        self.cloud = CloudStore(DB)
        self.cloud.settings = asdict(self.settings)
        self.mode = mode
        self.port: str | None = None
        self.transport = "USB serial"
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
        # New zone packets already contain independently filtered RMS current.
        # Keep the old smoothing/coupled rule only for unmarked feeder firmware.
        if "s1_raw_mA" not in packet and packet.get("independent") != 1:
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
            if (self.previous_power and reading["valid_for_energy"]
                    and self.previous_power["sensor_layout"] == reading["sensor_layout"]):
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
                            "Consumption outside operating hours", "Monitored loads remain active during configured quiet hours")
                self._alert("mismatch", any(f.startswith("METER_MISMATCH") for f in reading["flags"]),
                            "Sensor disagreement", "Branch sensor exceeds feeder; check sensor placement and scaling")
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

    def dashboard(self) -> dict:
        st = self.state()
        st["cloud"] = self.cloud.status()
        st["source"] = "local"
        return st

    def analytics(self, range_name="24h", mode=None):
        mode = mode or self.mode
        start, end, bucket = parameters(range_name, mode)
        rate = self.settings.tariff_inr_per_kwh
        with db_connection() as conn:
            rows = local_analytics(conn, mode, start, end, bucket, rate)
            previous = local_analytics(conn, mode, start-(end-start), start-0.000001, bucket, rate)
            latest = conn.execute("SELECT timestamp AS ts,main_w,branch_a_w AS a_w,branch_b_w AS b_w FROM samples WHERE data_mode=? ORDER BY timestamp DESC LIMIT 1", (mode,)).fetchone()
            events = [dict(r) for r in conn.execute("SELECT timestamp AS ts,kind,title,details FROM events WHERE data_mode=? ORDER BY timestamp DESC LIMIT 15", (mode,))]
        return report(rows, previous, start, end, bucket, rate, source="local", mode=mode,
                      device_id=self.cloud.device_id, cloud=self.cloud.status(), latest=dict(latest) if latest else None,
                      events=events, tariff=tariff_details(rate))

    def state(self) -> dict:
        with self.lock:
            age = time.time() - self.last_packet_wall if self.last_packet_wall else None
            live = age is not None and age < 4 and self.connection_status in ("CONNECTED", "SIMULATION")
            if self.mode == "DEMO":
                connection = "SIMULATION" if live else "WAITING"
            else:
                connection = ("CONNECTED" if live else "WAITING"
                              if self.connection_status == "WAITING_FOR_DATA" else "DISCONNECTED")
            with db_connection() as conn:
                history = [dict(r) for r in conn.execute("""SELECT timestamp,main_w,branch_a_w,
                 branch_b_w,residual_ma FROM samples WHERE data_mode=? ORDER BY timestamp DESC LIMIT 120""", (self.mode,))]
                recent_events = [dict(r) for r in conn.execute("SELECT timestamp,kind,title,details FROM events WHERE data_mode=? ORDER BY id DESC LIMIT 20", (self.mode,))]
            return {
                "mode": self.mode, "connection": connection, "port": self.port,
                "transport": self.transport,
                "last_packet": self.last_line,
                "age_seconds": round(age, 2) if age is not None else None,
                "latest": self.latest if live else None,
                "last_known": self.latest if not live else None,
                "totals": {"total_wh": round(self.total_wh, 5), "a_wh": round(self.a_wh, 5),
                           "b_wh": round(self.b_wh, 5),
                           "cost_inr": round(self.total_wh / 1000 * self.settings.tariff_inr_per_kwh, 5)},
                "settings": asdict(self.settings), "tariff": tariff_details(self.settings.tariff_inr_per_kwh), "events": recent_events,
                "history": list(reversed(history)), "error": self.error,
                "calibration_status": ("AUTO_ON_FIRMWARE_BOOT" if (self.latest and self.latest["firmware"] in ("legacy", "energy_monitor_independent_v1")) else self.calibration_status),
                "firmware_compatibility": "Independent zone firmware supported; unmarked older packets keep feeder/branch mapping",
            }

    def clear_data(self) -> dict[str, int]:
        with self.lock:
            with db_connection() as conn:
                conn.execute("PRAGMA secure_delete=ON")
                deleted = {
                    "samples": conn.execute("SELECT COUNT(*) FROM samples").fetchone()[0],
                    "events": conn.execute("SELECT COUNT(*) FROM events").fetchone()[0],
                }
                conn.execute("DELETE FROM samples")
                conn.execute("DELETE FROM events")
                conn.execute("DELETE FROM cloud_outbox")
                conn.execute("DELETE FROM sqlite_sequence WHERE name='events'")
            self.total_wh = self.a_wh = self.b_wh = 0.0
            self.previous_power = None
            self.last_recorded_wall = 0.0
            self.events.clear()
            self.last_alert_at.clear()
            self.alert_hits.clear()
            return deleted

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
            self.cloud.settings = asdict(updated)
            self.log_event("info", "Settings updated", "Configured estimates/calibration; historical records not retroactively recalculated")
            return asdict(updated)

    def request_idle_calibration(self) -> bool:
        # Deliberately don't send CAL:IDLE to legacy firmware: that command
        # was not implemented in the original dotted-board sketch.
        if self.latest and self.latest.get("firmware") in ("legacy", "energy_monitor_independent_v1"):
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
            with engine.lock:
                engine.port = None
                engine.connection_status = "DISCONNECTED"
                engine.error = "No serial port detected. Connect the board with a USB data cable or choose --port COM5."
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
                    engine.error = f"Serial port {dev} is open; waiting for DATA at 115200 baud."
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
        packet = {"s1_mA": max(0, a + wiggle) if a else 0,
                  "s2_mA": max(0, b + wiggle / 2) if b else 0,
                  "independent": 1,
                  "s1_raw_mA": max(0, a + wiggle + 1.8),
                  "s2_raw_mA": max(0, b + wiggle / 2 + 1.8),
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

    @app.get("/analytics")
    def analytics_page():
        return render_template("analytics.html", hosted=False)

    @app.get("/api/analytics")
    def analytics_api():
        try:
            return jsonify(engine.analytics(request.args.get("range", "24h"), request.args.get("mode", engine.mode)))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400

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

    @app.post("/api/clear-data")
    def clear_data():
        body = request.get_json(silent=True) or {}
        if body.get("confirmation") != "clear data":
            return jsonify(error="Type 'clear data' to confirm permanent deletion"), 400
        deleted = engine.clear_data()
        return jsonify(ok=True, deleted=deleted, state=engine.dashboard())

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
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env')
    parser = argparse.ArgumentParser(description="Soldered-board energy audit monitor")
    parser.add_argument("--port", help="USB serial port (auto-detected when omitted), e.g. COM3")
    parser.add_argument("--web-port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1", help="Set 0.0.0.0 to open on your LAN; protect the network")
    parser.add_argument("--demo", action="store_true", help="Explicit, clearly labeled simulated readings")
    parser.add_argument("--open-browser", action="store_true", default=True, help="Open the dashboard automatically (default)")
    parser.add_argument("--no-browser", action="store_false", dest="open_browser", help="Do not open a browser")
    args = parser.parse_args()
    if args.port and args.demo:
        parser.error("Choose either --port or --demo")
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
    target = demo_feeder if args.demo else serial_reader
    kwargs = {"args": (engine,)} if args.demo else {"args": (engine, args.port)}
    threading.Thread(target=target, daemon=True, **kwargs).start()
    if args.open_browser:
        threading.Thread(target=open_dashboard, args=(http_server.server_port,), daemon=True).start()
    print(f"Energy Monitor ({engine.mode}) -> http://localhost:{http_server.server_port}")
    print(f"Usage analytics -> http://localhost:{http_server.server_port}/analytics")
    print("MongoDB: background sync enabled; readings stay saved locally if internet is unavailable."
          if engine.cloud.enabled else "MongoDB: not configured. Running locally; add MONGODB_URI in .env to upload a copy.")
    print("AC watt/kWh readings are estimates at configured voltage, not revenue-grade measurements.")
    try:
        http_server.serve_forever()
    finally:
        http_server.server_close()
        engine.cloud.close()


if __name__ == "__main__":
    main()
