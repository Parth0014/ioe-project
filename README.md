# GridScope energy monitor

## Quick demo: one command

1. Flash `firmware/energy_usb/energy_usb.ino` to the ESP8266.
2. Connect the ESP8266 to the laptop with a USB data cable.
3. Run `python app.py`. It connects over USB serial, records data, starts the dashboard,
   analytics and optional MongoDB uploading together, and opens your browser.

The complete demo works without internet after Python dependencies are installed.
SQLite saves all readings locally. For an additional MongoDB copy, put your Atlas
URI in the private `.env` file's `MONGODB_URI` value once. No Vercel deployment,
dashboard password or separate service command is needed. Uploads require internet
and Atlas network access; missed uploads retry after reconnecting. USB powers
the ESP8266 and carries its readings to the computer. A charge-only cable will
power the board but cannot transfer data.

For the complete teammate walkthrough, including Arduino setup, USB serial,
flashing, calibration, live operation and troubleshooting, read
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

Analytics always uses history from the Python service. Live Server cannot serve
the `/analytics` route or read SQLite. Run `python app.py` and open
`http://127.0.0.1:8765/analytics` (use the port printed in the terminal).
The page reads local SQLite and does not require MongoDB or internet.

## Flash once

1. Open `firmware/energy_usb/energy_usb.ino` in Arduino IDE.
2. Select the ESP8266 board and its USB COM port. Install the ESP8266 board
   package and Adafruit ADS1X15 library if needed, then upload.
3. Keep both bulbs OFF during startup baseline calibration.
4. Close Arduino Serial Monitor before starting Python; only one program can
   use the board's COM port at a time.

## Start the dashboard

In VS Code, open a new integrated terminal after this workspace loads. The
workspace puts its Python runtime and project environment on that terminal's
PATH, so you do not need to activate an environment. First-time setup requires
internet to install dependencies:

```powershell
python -m pip install -r requirements.txt
```

Connect the ESP8266 to the computer with a USB data cable, then run:

```powershell
python app.py
```

The dashboard opens automatically while Python listens for serial readings.
It tries local dashboard ports **8765-8775** and opens the available one.
Keep the terminal open. You can also double-click `start_dashboard.cmd`, or
run `.\run_windows.ps1` (these install dependencies before starting).

Use **Dashboard** for readings, charts and energy totals. Switch to
**Debugging** for USB connection status, the selected COM port, raw sensor
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
until they are visible again. Dashboard API polling pauses in hidden tabs, and
unchanged charts, analytics rows and debugging details keep their existing elements.
Flow pulse counts follow cable length and available screen space, with one
pulse on the short Zone A branch. Dialogs, screen entrances, and controls use
brief native browser animations that respect reduced-motion preferences.

The renderer is served locally from `static/vendor` (Three.js 0.180.0, MIT
license included). No CDN, downloaded model, or internet connection is needed
to render the dashboard. If WebGL is unavailable, a simple room diagram is
shown and the live readings remain usable.

## USB serial connection

The service automatically selects a likely ESP8266 USB serial port. If several
serial devices are connected, specify the board's port explicitly, for example
`python app.py --port COM5`. Find the port in Arduino IDE under **Tools → Port**
or in Windows Device Manager. The firmware uses **115200 baud**.

The board restarts when Python opens its serial port, then calibrates. Keep both
bulbs off until calibration finishes. If no port appears, check that the cable
supports data, install the board's USB-to-serial driver (often CH340 or CP210x),
and close Arduino Serial Monitor. `ADS1115_NOT_FOUND` means the serial link works
but the sensor converter is not detected; check its power and I2C wiring.

The dashboard's **Debugging** screen shows the selected port, connection status,
latest serial packet and any error. Python retries serial connection when the
board is unplugged or the port is busy.

## Other run modes

- Explicit USB serial port: `python app.py --port COM5` (close Serial Monitor first).
- Backend demo: `python app.py --demo` (mode is visible in Debugging; the dashboard has no simulation banner).
- No automatic browser: `python app.py --no-browser`
- Different dashboard port range: `python app.py --web-port 9000` tries 9000-9010.

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
the application works locally. USB telemetry and local storage need no internet
after dependencies have been installed.
