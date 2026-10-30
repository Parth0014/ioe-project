"""Bounded IPv4/HTTP scanning with results suitable for dashboard diagnostics."""
import ipaddress
import json
import os
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import ProxyHandler, build_opener


def local_ranges():
    addresses = []
    if os.name == "nt":
        # Only interfaces with a gateway; avoid scanning disconnected/virtual adapters.
        try:
            result = subprocess.run([
                "powershell.exe", "-NoProfile", "-Command",
                "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address.IPAddress }"
            ], capture_output=True, text=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
            addresses = result.stdout.splitlines()
        except (OSError, subprocess.TimeoutExpired):
            pass
    if not addresses:
        try:
            addresses = [a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
        except OSError:
            pass
    ranges = set()
    for address in addresses:
        try:
            ip = ipaddress.IPv4Address(address.strip())
            if ip.is_private and not (ip.is_loopback or ip.is_link_local or ip.is_unspecified):
                ranges.add(str(ipaddress.ip_network(f"{ip}/24", strict=False)))
        except ValueError:
            pass
    return sorted(ranges)


def load_scan_config(path: Path):
    config = json.loads(path.read_text(encoding="utf8"))
    ranges, ports = config.get("ranges"), config.get("ports")
    if not isinstance(ranges, list) or not ranges or len(ranges) > 8:
        raise ValueError("network_scan.json: provide 1 to 8 ranges (auto or IPv4 CIDR)")
    for value in ranges:
        if value == "auto":
            continue
        net = ipaddress.ip_network(value, strict=False)
        if net.version != 4 or net.prefixlen < 24 or not net.is_private:
            raise ValueError("Scan ranges must be private IPv4 /24 or smaller")
    if not isinstance(ports, list) or not 1 <= len(ports) <= 8 or any(type(p) is not int or not 1 <= p <= 65535 for p in ports):
        raise ValueError("network_scan.json: provide 1 to 8 ports between 1 and 65535")
    timeout = float(config.get("timeout_seconds", 0.7))
    workers = config.get("workers", 24)
    if not 0.2 <= timeout <= 3 or type(workers) is not int or not 1 <= workers <= 32:
        raise ValueError("Scan timeout must be 0.2..3 seconds and workers 1..32")
    return {"ranges": ranges, "ports": list(dict.fromkeys(ports)), "timeout_seconds": timeout, "workers": workers}


def scan_targets(config):
    ranges = []
    for entry in config["ranges"]:
        ranges.extend(local_ranges() if entry == "auto" else [entry])
    ranges = list(dict.fromkeys(ranges))
    hosts = list(dict.fromkeys(str(ip) for net in ranges for ip in ipaddress.ip_network(net, strict=False).hosts()))
    if len(hosts) > 2048:
        raise ValueError("Scan exceeds 2048 hosts; narrow the configured ranges")
    return ranges, [f"http://{host}:{port}" for host in hosts for port in config["ports"]]


def read_health(base_url, timeout):
    opener = build_opener(ProxyHandler({}))
    with opener.open(base_url + "/health", timeout=timeout) as response:
        body = response.read(2049)
    if len(body) > 2048:
        raise ValueError("Health response exceeds 2048 bytes")
    data = json.loads(body)
    if not isinstance(data, dict) or data.get("device") != "GridScope" or data.get("protocol") != 1:
        raise ValueError("HTTP server responded, but it is not GridScope scan firmware")
    return data


def probe(base_url, timeout):
    start = time.monotonic()
    try:
        health = read_health(base_url, timeout)
        return {"url": base_url, "result": "FOUND", "detail": health.get("status", "Device found"), "device": health,
                "ms": round((time.monotonic() - start) * 1000)}
    except (OSError, ValueError, UnicodeError) as exc:
        return {"url": base_url, "result": "FAILED", "detail": str(exc)[:240],
                "ms": round((time.monotonic() - start) * 1000)}


def scan_once(config, report):
    ranges, targets = scan_targets(config)
    report({"phase": "Scanning", "ranges": ranges, "ports": config["ports"], "total": len(targets), "attempted": 0})
    if not targets:
        raise ValueError("No scan targets. Connect to Wi-Fi or set ranges in network_scan.json")
    found = None
    with ThreadPoolExecutor(max_workers=config["workers"]) as pool:
        futures = {pool.submit(probe, target, config["timeout_seconds"]): target for target in targets}
        for future in as_completed(futures):
            if future.cancelled():
                continue
            result = future.result()
            report({"attempt": result})
            if result["result"] == "FOUND" and found is None:
                found = result
                # Stop scheduling unused work; already-running requests still finish cleanly.
                for pending in futures:
                    pending.cancel()
    return found
