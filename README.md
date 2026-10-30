# GridScope energy monitor

## Flash once

1. Open `firmware/energy_wifi/energy_wifi.ino` in Arduino IDE.
2. Enter your phone hotspot name/password in the `wifi_config.h` tab. Keep that
   file private. Select your ESP8266 board, install the ESP8266 board package
   and Adafruit ADS1X15 library if needed, then upload.
3. Keep both bulbs OFF during startup baseline calibration.

The ESP serves the same endpoints on **80, 8080 and 8081** simultaneously:

- `/health`: identifies GridScope and reports calibration/sensor/Wi-Fi status.
- `/telemetry`: actual sensor readings with boot/sequence IDs.
- `/`: short endpoint instructions for direct browser troubleshooting.

The ESP joins your hotspot using DHCP. It also creates a direct Wi-Fi network:

| Setting | Value |
| --- | --- |
| Wi-Fi name | `GridScope-Setup` |
| Wi-Fi password | `GridScope123` |
| Fixed ESP address on that network | `192.168.50.1` |
| Ports | `80`, `8080`, `8081` |

For the simplest debug setup, connect the laptop directly to `GridScope-Setup`.
No phone hotspot is needed in that mode. On a phone hotspot, both laptop and
ESP must be connected to the same 2.4 GHz hotspot and client communication
must be allowed. The fixed address belongs to the ESP's direct network, not
its hotspot connection. A different device using port 80 at another IP does
not conflict with the ESP.

## Start the dashboard

Install Python 3.10+ with PATH enabled. First-time setup requires internet:

```powershell
python -m pip install -r requirements.txt
```

Then connect to the ESP Wi-Fi or the phone hotspot and run:

```powershell
python server.py
```

The dashboard opens automatically while Python scans in the background.
It tries local dashboard ports **8765-8775** and opens the available one.
Keep the terminal open. You can also double-click `start_dashboard.cmd`, or
run `.\run_windows.ps1` (these install dependencies before starting).

Use **Dashboard** for readings, charts, energy totals and events. Switch to
**Debugging** for connection errors, scan results, device health, raw sensor
packets and the full API response. The screen links support browser Back and
direct links (`/#dashboard` and `/#debugging`); readings keep updating while
you switch screens.

The full-width Dashboard includes an interactive 3D illustration of the two
lighting circuits. Drag the room model, use Perspective/Top view, or use the
rotate and zoom buttons. Select a room label or circuit card to inspect its
reading. The focused 3D canvas also supports arrow keys, +/-, and Home.
The mouse wheel, trackpad pinch and two-finger touch pinch zoom the model
while the pointer is over it. Browser zoom and page scrolling work normally
outside the model. The opening layout fits the model and primary readings to
the available viewport height; charts and event history follow below.
Power-flow animation and lamp illumination follow fresh circuit readings;
they stop when data goes stale. Pause flow or your system's reduced-motion
setting stops the animation. Room layout and furniture are illustrative;
lighting follows the activity of the two circuits.
Static geometry is batched, shadows are cached, and resolution is capped to
limit GPU work. Idle flow renders at 30 fps while camera interaction uses the
browser's frame rate. Rendering stops when paused, offscreen, or in Debugging.

The renderer is served locally from `static/vendor` (Three.js 0.180.0, MIT
license included). No CDN, downloaded model, or internet connection is needed
to render the dashboard. If WebGL is unavailable, a simple room diagram is
shown and the live readings and circuit inspection remain usable.

## What Python scans

`network_scan.json` contains the address ranges, port options and timeouts:

```json
{
  "ranges": ["auto", "192.168.50.1/32"],
  "ports": [80, 8080, 8081],
  "timeout_seconds": 0.7,
  "workers": 24
}
```

`auto` scans the private /24 containing each connected laptop gateway
interface (up to 254 IPs per subnet). The second entry explicitly checks the
ESP's fixed direct address. For a known small range, use CIDR notation such as
`192.168.43.192/28`; for one IP use `192.168.43.20/32`. Configured ranges must
be private IPv4 /24 or smaller. Only these configured ports are probed.

The page shows scan round, resolved ranges, ports, completed checks, recent
URL results with timings, sensor status and the last packet. Python accepts
only an HTTP `/health` response identifying the GridScope protocol, so an
unrelated web server is not mistaken for a sensor. It retries a failed scan
after three seconds. After three connection failures it rescans automatically.
Edit `network_scan.json` while disconnected and the next scan reloads it.

On a larger subnet, `auto` deliberately checks only the laptop's /24. Add the
ESP's actual /24 to the config if it is elsewhere. No multicast, Bonjour or
IP entry in the browser is needed. A scan may take tens of seconds depending
on the number of configured ranges and network timeouts.

## Debugging from the page

- **All attempts fail:** verify the laptop's Wi-Fi network. Try connecting
  directly to `GridScope-Setup` to bypass hotspot isolation.
- **HTTP responds but not GridScope:** the address belongs to another device,
  or the ESP has older firmware; flash this sketch.
- **WAITING_FOR_RAILS / CALIBRATING:** keep both bulbs off and wait.
- **ADS1115_NOT_FOUND:** ESP networking is working; check ADC power and I2C wiring.
- **READY but packet not advancing:** the ESP responds but readings have stalled.
- **Small currents display zero:** the server retains eight-sample smoothing
  and a 20 mA cutoff. Expand the last-packet section to see transmitted values.

Direct manual checks, if needed: `http://192.168.50.1/health` or
`http://192.168.50.1:8080/health` while connected to the ESP Wi-Fi.

## Other run modes

- Exact device: `python server.py --device-url http://192.168.50.1:8081/telemetry`
- USB serial: `python server.py --port COM3` (close Serial Monitor first).
- Labeled simulation: `python server.py --demo`
- No automatic browser: `python server.py --no-browser`
- Different dashboard port range: `python server.py --web-port 9000` tries 9000-9010.

## Data and configuration

`config.json` controls assumed voltage, tariff, demand threshold, quiet hours
and reference gains. Watts/Wh are estimates from measured RMS current at
assumed voltage, not measured real power. Zone B is inferred from feeder
minus Zone A. Sensor calibration/math retains the original behavior.

Local data is stored in `energy.sqlite3`, created on first run. CSV export is
available on the dashboard. Live and demo data are separated. Re-reading a
cached packet cannot add energy or keep the sensor marked live. Last-known
values may remain visible after disconnect; their age is shown.

Optional MongoDB sync uses `MONGODB_URI` and `MONGODB_DB` (default
`energy_monitor`). Keep connection strings out of source files. Without these,
the application works locally. Neither Wi-Fi operation nor local storage needs
internet after dependencies have been installed.
