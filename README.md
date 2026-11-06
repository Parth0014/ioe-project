# GridScope energy monitor

## Quick demo: one command

1. Flash `firmware/energy_wifi/energy_wifi.ino` once to the ESP8266.
2. Connect the laptop to the ESP's Wi-Fi, or put both on the same hotspot.
3. Run `python app.py`. It starts device discovery, recording, the dashboard,
   analytics and optional MongoDB uploading together, and opens your browser.

The complete demo works without internet after Python dependencies are installed.
SQLite saves all readings locally. For an additional MongoDB copy, put your Atlas
URI in the private `.env` file's `MONGODB_URI` value once. No Vercel deployment,
dashboard password or separate service command is needed. Uploads require internet
and Atlas network access; missed uploads retry after reconnecting. The ESP's
direct setup Wi-Fi alone has no internet, so use a hotspot with internet if you
want to demonstrate MongoDB writes during the demo.

For the complete teammate walkthrough, including Arduino setup, hotspot
credentials, flashing, calibration, live operation and troubleshooting, read
[TEAM_GUIDE.md](TEAM_GUIDE.md).

## Frontend preview without hardware

Open `templates/index.html` using VS Code Live Server. That HTML preview
automatically uses browser-generated sample data, without Python or an ESP.
Use the **Preview controls** button at the bottom-right to open the floating
menu. Choose **Both off**, **Zone A on**, **Zone B on**, or **Both on** to compare
room lighting. The menu starts closed and dismisses with Escape or a click
outside, so you can inspect the final dashboard layout. Export produces a sample
CSV locally. No device data or saved database is changed by this mode.

You can also enable this frontend preview on the Python-served dashboard by
adding `?demo=1` to its URL (for example `http://127.0.0.1:8765/?demo=1`).
The normal Python dashboard URL continues to use real telemetry.

The Analytics link also works in this preview and opens explicitly labelled
browser sample data. Live Server cannot serve Python's `/analytics` route or
read SQLite. For your actual saved readings, run `python app.py` and open
`http://127.0.0.1:8765/analytics` (use the port printed in the terminal).
That page reads local SQLite and does not require MongoDB or internet.

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
python app.py
```

The dashboard opens automatically while Python scans in the background.
It tries local dashboard ports **8765-8775** and opens the available one.
Keep the terminal open. You can also double-click `start_dashboard.cmd`, or
run `.\run_windows.ps1` (these install dependencies before starting).

Use **Dashboard** for readings, charts and energy totals. Switch to
**Debugging** for connection errors, scan results, device health, raw sensor
packets and the full API response. The screen links support browser Back and
direct links (`/#dashboard` and `/#debugging`); readings keep updating while
you switch screens.

The full-width Dashboard shows the supplied GridScope living/dining model,
with a sofa, TV console, dining table, open bookcase, plants and central doorway.
The TV and shelves face the fixed camera so their details remain readable.
The view faces straight forward, with
the camera elevated 45 degrees. It automatically fits the model panel on desktop and mobile; the canvas
has no camera controls or reading overlays. Minimal Zone A/B callouts sit
outside the model and appear only while their circuit is active; on narrow
screens they sit above it. Readings stay in the side
panel. The opening layout fits the model and primary readings to the available
viewport height, with charts and history below.

Warm fixture lighting casts cached shadows across the room. A local reflected-
light fill brightens walls and furniture when a circuit is active. This is a
visual lighting approximation, not a simulation of the physical building.
The three on states (A, B, both) and the off state can be compared using the
floating Preview controls menu. Pause flow is also in that menu; the system
reduced-motion setting stops animation automatically.

Power-flow animation and room lighting follow fresh circuit readings and stop
when data goes stale. The surrounding dashboard keeps its neutral light palette.
Geometry is batched, static shadows are cached, and render resolution is capped.
The 3D room renders only when lighting or panel size changes.
The drawing buffer stays at a stable resolution during lighting changes, capped
at 1.5 million pixels (800,000 on lower-power devices) and the display's own density.
Fixture shadows use cached 512-pixel spotlight maps rather than cube maps.
Moving flow dots use a small 2D overlay capped at 30 fps; cached visibility checks keep them
behind furniture. Animation stops when paused, offscreen, in a hidden tab, or
in Debugging. Offscreen charts and hidden debugging details also skip updates
until they are visible again. Network polling pauses in hidden tabs, and unchanged
charts and scan tables keep their existing elements instead of rebuilding.
Flow pulse counts follow cable length and available screen space, with one
pulse on the short Zone A branch. Dialogs, screen entrances, and controls use
brief native browser animations that respect reduced-motion preferences.

The renderer is served locally from `static/vendor` (Three.js 0.180.0, MIT
license included). No CDN, downloaded model, or internet connection is needed
to render the dashboard. If WebGL is unavailable, a simple room diagram is
shown and the live readings remain usable.

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
- Backend demo: `python server.py --demo` (mode is visible in Debugging; the dashboard has no simulation banner).
- No automatic browser: `python server.py --no-browser`
- Different dashboard port range: `python server.py --web-port 9000` tries 9000-9010.

## Data and configuration

`config.json` controls assumed voltage, tariff, demand threshold, quiet hours
and reference gains. Watts/Wh are estimates from measured RMS current at
assumed voltage, not measured real power. Each ACS712 measures one separate
bulb/zone: sensor 1 (ADS1115 A0) is Zone A and sensor 2 (A1) is Zone B.
New firmware sends `independent=1`; Python uses each current directly and sums
the two zone power estimates for the monitored total. Sensor 2 can remain active
when sensor 1 reads zero. There are no theft calculations in the firmware.

Upload the revised sketch and restart Python together. Older packets without
`independent=1` retain their original feeder/branch interpretation for compatibility.
Saved history is not recalculated. The existing gain setting names are retained:
`main_reference_gain` scales sensor 1 and `branch_reference_gain` scales sensor 2
for independent packets. The firmware retains its startup calibration, sensor
scale factors and 20 mA noise floor; confirm scaling against your actual sensors.

The default energy-cost estimate uses MSEDCL LT I(B) residential, first 100
monthly kWh: ₹3.96 energy plus ₹1.60 wheeling = ₹5.56/kWh for FY 2026–27.
The source is [MERC's 25 March 2026 order, page 95](https://www.mahadiscom.in/wp-content/uploads/2026/07/Tariff-Order_Case-No.-75-of-2025-dated-25th-March-2026.pdf#page=95),
published on Mahavitaran's official website. Reference data and validity dates
are in `static/electricity-tariff.json`, shared by Python and frontend preview.
The rate link beside the cost opens that source.

Cost = recorded Wh ÷ 1000 × configured rate. For example, 4 Wh costs ₹0.02224
at the default rate. This values monitored energy at one assumed slab; it is
not a household bill calculator. Household monthly consumption is unknown,
and fixed charges, FAC, electricity duty/taxes and time-of-day adjustments are
excluded. Other slabs, providers or commercial premises require a different
configured rate. A custom rate is labeled as custom, and an expired reference
is flagged for review. Cloud-sourced totals use the current configured rate
rather than an old stored cost. The measured energy history is preserved.

Local data is stored in `energy.sqlite3`, created on first run. CSV export is
available on the dashboard. Live and demo data are separated. Re-reading a
cached packet cannot add energy or keep the sensor marked live. Last-known
values may remain visible after disconnect; their age is shown.

MongoDB sync uses `MONGODB_URI` and `MONGODB_DB` (default
`energy_monitor`). Set the URI in `.env` once. The SQLite
outbox automatically backfills history and retries acknowledged, idempotent
uploads after disconnections and restarts. Open `/analytics` for recorded energy,
cost estimates, circuit shares, coverage and 24-hour / 7-day / 30-day trends.
Hosting is optional and unnecessary for the local demo. If needed later, the
separate hosted dashboard has its own [Cloud setup](docs/CLOUD_SETUP.md).
Keep connection strings out of source files. Without these,
the application works locally. Neither Wi-Fi operation nor local storage needs
internet after dependencies have been installed.
