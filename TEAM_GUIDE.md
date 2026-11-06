# GridScope: teammate setup and operating guide

This guide explains the current repository, from entering Wi-Fi credentials and flashing the ESP8266 to demonstrating the dashboard and diagnosing problems. It describes what the code does today. It does not assume that every teammate has used Arduino or Python before.

Measurement mapping updated on **4 November 2026** for one ACS712 per zone. For the current direct-hotspot setup, see [firmware/README.md](firmware/README.md). Other setup sections were reviewed on **31 October 2026**. Board upload and physical measurement accuracy still need to be checked on the team's actual hardware.

## Contents

1. [The system in one minute](#1-the-system-in-one-minute)
2. [What you need](#2-what-you-need)
3. [Choose a Wi-Fi arrangement](#3-choose-a-wi-fi-arrangement)
4. [Install Arduino support](#4-install-arduino-support)
5. [Enter credentials and upload](#5-enter-credentials-and-upload)
6. [First boot and calibration](#6-first-boot-and-calibration)
7. [Prepare Python and start the dashboard](#7-prepare-python-and-start-the-dashboard)
8. [What happens automatically](#8-what-happens-automatically)
9. [Run a physical demonstration](#9-run-a-physical-demonstration)
10. [Preview the frontend without hardware](#10-preview-the-frontend-without-hardware)
11. [How measurements and costs are calculated](#11-how-measurements-and-costs-are-calculated)
12. [Configuration and run modes](#12-configuration-and-run-modes)
13. [Debugging and common failures](#13-debugging-and-common-failures)
14. [Saved data, exports and optional cloud sync](#14-saved-data-exports-and-optional-cloud-sync)
15. [Files and responsibilities](#15-files-and-responsibilities)
16. [Team handoff and presentation checklist](#16-team-handoff-and-presentation-checklist)

## 1. The system in one minute

There are two separate computers involved: the ESP8266 reads the sensors, and the laptop runs the dashboard server.

```text
Physical lighting circuits
   |
   +-- Sensor S1: Zone A bulb current ----------> ADS1115 channel 0
   +-- Sensor S2: Zone B bulb current ----------> ADS1115 channel 1
                                                   |
                                                  I2C
                                                   |
                                                ESP8266
                                                   |
                                       HTTP over local Wi-Fi
                                       /health and /telemetry
                                                   |
                                        Python on the laptop
                              discovery, filtering, power, energy,
                                    cost and local SQLite storage
                                                   |
                                           /api/dashboard
                                                   |
                                         Browser dashboard
                                  readings, 3D room and charts
```

The browser normally talks to **Python**, not directly to the ESP. Python finds the ESP and fetches its measurements.

The ESP also prints measurements over USB serial. Seeing them in Arduino Serial Monitor proves the firmware is printing data; it does not prove that Python has connected to the ESP over Wi-Fi.

The 3D room is a visual representation of the two circuits. The software does **not** switch the physical lamps. You operate the physical circuit switches; the dashboard reacts to measured current.

## 2. What you need

| Item | Purpose |
| --- | --- |
| The team's assembled ESP8266, ADS1115 and current-sensor rig | Reads the two sensor channels |
| Two independently switchable lighting circuits | Zone A and Zone B demonstration |
| A USB **data** cable | Uploads firmware; can also power the ESP |
| Windows laptop | Runs Arduino IDE, Python and a browser |
| Arduino IDE | Compiles and uploads the sketch |
| ESP8266 Arduino board package | Adds ESP8266 board support |
| Adafruit ADS1X15 library | Talks to the ADS1115 |
| Python 3.10 or newer | Runs the server |
| A phone with a 2.4 GHz hotspot, or the ESP's own Wi-Fi | Connects the laptop to the ESP |
| This complete repository | Includes the locally served 3D renderer and tariff reference |

Internet is needed to download the board package, libraries and Python dependencies initially. Normal local operation does not require internet once these are installed. Optional MongoDB sync does require a route to the database.

Use the team's existing, checked electrical assembly. This repository does not include a complete circuit schematic or a verified power-supply/pin diagram. Confirm the physical build with the hardware teammate before rewiring it. Disconnect power before changing wiring; mains-side work needs appropriate supervision.

## 3. Choose a Wi-Fi arrangement

### Option A: phone hotspot

Use this when the ESP and laptop should both join the phone's network.

1. Turn on the phone hotspot.
2. Select **2.4 GHz** if the phone offers a band choice. Do not use a 5-GHz-only hotspot for this ESP8266 setup.
3. Note the exact hotspot name and password. These are case-sensitive.
4. Enter those credentials in the ESP sketch as described below.
5. Connect the laptop to that **same** hotspot using Windows Wi-Fi settings.
6. Keep the hotspot enabled. Check the phone's automatic hotspot shutoff setting if it disconnects during a presentation.

The hotspot assigns the ESP an address using DHCP. That address can change after a reconnect. Python searches for it, so the presenter does not normally have to type it into the browser.

Some hotspots prevent connected devices from communicating with one another. Both devices can appear connected while the laptop still cannot reach the ESP. If that happens, use Option B.

**Python does not need the hotspot password in a configuration file.** The ESP uses the credentials in its firmware; Windows handles the laptop's Wi-Fi login.

### Option B: connect the laptop directly to the ESP

This is the simplest way to bypass phone hotspot problems.

| Setting | Current value |
| --- | --- |
| Network name | `GridScope-Setup` |
| Network password | `GridScope123` |
| ESP address on this network | `192.168.50.1` |
| ESP HTTP ports | `80`, `8080`, `8081` |

1. Power the ESP.
2. Connect the laptop to `GridScope-Setup`.
3. If Windows reports **No internet**, stay connected: internet is not required for the local dashboard.
4. Start Python normally.

The sketch runs in `WIFI_AP_STA` mode: it creates its own network while also attempting to join the configured hotspot. The direct network remains useful if the hotspot credentials are wrong or the phone is absent. The ESP must still have power.

**Important:** `192.168.50.1` is the ESP's address on its own network. Do not assume it has that address when the laptop is connected only to the phone hotspot.

### Do not confuse these addresses

| Example | What it means |
| --- | --- |
| `http://192.168.50.1/health` | ESP diagnostic endpoint on the ESP's direct Wi-Fi |
| `http://192.168.50.1:8081/telemetry` | ESP sensor data on an alternative ESP port |
| `http://127.0.0.1:8765/` | Dashboard served by Python on the laptop |
| `http://127.0.0.1:5500/templates/index.html` | VS Code Live Server frontend preview; does not read the physical ESP |

Ports belong to a particular device/address. Another device using port 80 does not conflict with the ESP using port 80. Dashboard ports and ESP ports serve different purposes.

## 4. Install Arduino support

### ESP8266 board package

1. Install and open Arduino IDE.
2. Open **Preferences**.
3. Add this address to **Additional Boards Manager URLs**:

   ```text
   https://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```

4. Open **Boards Manager**, search for `esp8266`, and install the ESP8266 platform.
5. Select the board that matches the actual hardware. For example, choose a NodeMCU board entry only if the team is using that board. The repository does not identify a universal board setting for every ESP8266 module.

These installation steps follow the [official ESP8266 Arduino Core guide](https://arduino-esp8266.readthedocs.io/en/latest/installing.html).

### ADS1115 library

Open **Library Manager**, search for **Adafruit ADS1X15**, and install it along with dependencies requested by Arduino IDE. See [Adafruit's Arduino library instructions](https://learn.adafruit.com/adafruit-4-channel-adc-breakouts/arduino-code).

The sketch includes `Adafruit_ADS1X15.h`. `Wire`, `ESP8266WiFi` and `ESP8266WebServer` come from the board/core environment; do not substitute an ESP32 sketch or ESP32 board package.

## 5. Enter credentials and upload

### Open the correct sketch

Open:

```text
firmware/energy_wifi/energy_wifi.ino
```

Keep the sketch inside the `energy_wifi` folder. Arduino uses the sketch folder and filename together.

### Create the local credential file

The sketch expects this file beside the `.ino`:

```text
firmware/energy_wifi/wifi_config.h
```

It is deliberately ignored by Git. A teammate's fresh clone may not contain it. If the tab is missing, create a file named exactly `wifi_config.h` in that folder. Do not accidentally save it as `wifi_config.h.txt`.

Example contents, using an **example** hotspot name and password:

```cpp
#pragma once

const char* WIFI_SSID = "GridScopeTeam";
const char* WIFI_PASSWORD = "ReplaceWithYourHotspotPassword";
```

Replace both example values with the phone's exact credentials. Keep the quotes and semicolons. A quote or backslash inside a password needs correct C++ string escaping; a simple hotspot name/password is easier for the team to maintain.

Do not commit or share your real credential file. Share these instructions instead. The direct-network password is configured separately inside the `.ino`; changing `WIFI_PASSWORD` does not change `GridScope-Setup`'s password.

### Select the port and upload

1. Connect the ESP using a USB data cable.
2. Select the correct ESP8266 board in Arduino IDE.
3. Select its COM port. Unplugging and reconnecting the board can help identify which port appears.
4. Close another program that may be using that COM port, including a Python server started in USB serial mode.
5. Click **Verify** to compile.
6. Click **Upload** and wait for Arduino IDE to report completion.
7. If the board requires a manual boot-button procedure, follow the procedure for that exact board; do not guess from a different module.

If no COM port appears, check the cable and Windows Device Manager. Identify the board's USB-to-serial chip before installing its appropriate driver.

Firmware upload still uses USB. After upload, telemetry can use Wi-Fi; USB may remain connected just for power. The ESP does not continue running without a power source.

**Changing hotspot credentials requires editing `wifi_config.h` and uploading again.** This firmware does not provide a browser-based Wi-Fi credential editor.

## 6. First boot and calibration

Keep **both physical lighting circuits OFF before the ESP starts** and leave them off until it is ready.

The startup sequence in the current sketch is:

1. Start USB serial at **115200 baud**.
2. Create `GridScope-Setup` and attempt to join the phone hotspot.
3. Start the three HTTP servers.
4. Start I2C and initialize the ADS1115.
5. Wait through a five-second power-rail countdown.
6. Discard initial ADC readings, then collect **400 baseline readings per sensor channel**.
7. Set sensor status to `READY` and begin measurements.

Calibration takes additional time after the five-second countdown. Wait for `READY`; do not assume that five seconds is the complete boot time.

Open Arduino Serial Monitor at **115200** if you want to see startup progress. Expected messages include:

```text
WIFI:DIRECT=GridScope-Setup IP=192.168.50.1 PORTS=80,8080,8081
WIFI:CONNECTING (use a 2.4 GHz hotspot)
CAL:WAITING_FOR_RAILS
CAL:COUNTDOWN,5
...
CAL:STARTED
CAL:BASELINE,s1=...,s2=...
INFO:READY
DATA,s1_mA=...,s2_mA=...,independent=1,boot=...,seq=...
```

On joining the hotspot, it also prints a `WIFI:TELEMETRY_URL=http://.../telemetry` line. This can appear at a different point depending on when Wi-Fi connects.

If a lamp was on during baseline calibration, switch both lamps off and reset/restart the ESP. The supplied sketch calibrates at boot; it does not implement a live recalibration command. The server's `/api/calibrate-idle` route is not an alternative for this sketch.

An ADS1115 initialization failure leaves `/health` reachable with `ADS1115_NOT_FOUND` in the status. That means the network can work even though sensor readings are unavailable.

## 7. Prepare Python and start the dashboard

### First-time laptop setup

Install Python **3.10+**, enable its PATH option, and reopen the terminal. In PowerShell:

```powershell
python --version
```

If Windows provides the Python launcher instead:

```powershell
py --version
```

Open a terminal in the repository root, the folder containing `server.py` and `requirements.txt`. For example, on the original development laptop:

```powershell
cd "C:\Users\jaypa\OneDrive\Desktop\Energy_Monitoring"
```

Use your own checkout path on another laptop.

### Recommended Windows launcher

Double-click **`start_dashboard.cmd`**, or run:

```powershell
.\start_dashboard.cmd
```

It starts `run_windows.ps1` with a process-scoped execution-policy override. The PowerShell script creates `.venv` if necessary, installs `requirements.txt` into it, then starts Python with automatic browser opening.

The launcher runs pip on every launch. Prepare dependencies while internet is available before a presentation. For offline operation after setup, call the installed environment directly as shown below.

### If PowerShell rejects the unsigned `.ps1`

You may see “cannot be loaded” or “not digitally signed” when running `run_windows.ps1` directly. Use the `.cmd` launcher above, or this one-process command from the project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run_windows.ps1
```

This does not change the machine-wide execution policy. If an organization policy still blocks it, use the direct Python route below rather than changing that policy globally.

### Manual environment setup

This is useful if you do not want to use the launcher:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

Use `py -m venv .venv` for the first line if your machine uses `py`. Activating the environment is not required when calling its Python executable directly.

On subsequent runs, after dependencies are installed:

```powershell
.\.venv\Scripts\python.exe server.py
```

### If an existing `.venv` points to a missing Python

An environment copied from another laptop, or created before Python was moved/uninstalled, may fail with `No Python at ...`. This was observed in the current development checkout while reviewing the guide. The launcher checks whether its environment executable exists; it does not repair a broken base-Python path automatically.

Stop any running server. Confirm that `py --version` or `python --version` works, then recreate the environment. To keep the old folder as a backup:

```powershell
Rename-Item -LiteralPath .venv -NewName .venv-backup
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

If `.venv-backup` already exists, choose another unused backup name. Use `python -m venv .venv` instead of `py -m venv .venv` if that is your installed working interpreter. This process keeps `energy.sqlite3` and the project configuration in place. Teammates should create their own environments instead of copying `.venv` between machines.

### Connect and run

1. Power the ESP with both circuits off and let calibration finish.
2. Connect the laptop to either the same phone hotspot or `GridScope-Setup`.
3. Start the server.
4. Keep the terminal open.
5. Use the browser tab opened by Python.

Python normally starts at `http://127.0.0.1:8765/`. If a port is occupied, it tries **8765 through 8775** and opens the available one. The final `Energy Monitor (...) -> http://localhost:...` terminal message gives the actual port. The launcher's earlier “Open ...8765” line is only the requested starting port.

For real data, use that normal Python dashboard URL, without `?demo=1`. Do not use Live Server's `/templates/index.html` page for the hardware demonstration.

Stop the server with **Ctrl+C**. Restart it after changing `config.json` manually. Refresh the browser with **Ctrl+F5** after frontend changes if cached files appear stale.

## 8. What happens automatically

### Discovery

The browser can open before the ESP has been found. Python searches in the background:

1. Read `network_scan.json`.
2. Resolve `auto` into private `/24` ranges associated with the laptop's network interfaces. On Windows, gateway-bearing interfaces are preferred.
3. Include the explicit `192.168.50.1/32` target.
4. Probe `/health` on ports **80, 8080 and 8081**, with up to **24 workers** and a **0.7-second** probe timeout by default.
5. Accept a response only if it identifies `device: GridScope` and `protocol: 1`.
6. Check the device's sensor status. Start consuming `/telemetry` when it reports `READY`.

There is no fixed promise that scanning finishes instantly. A full subnet with unreachable addresses can take tens of seconds. Use Debugging to see progress rather than restarting repeatedly.

`auto` checks the local `/24`, even if the physical network has a broader subnet. Explicit ranges must be private IPv4 `/24` or smaller. Power only the intended GridScope board during a demo: with multiple matching boards, discovery uses the first one found.

### Reading and refreshing

The ESP exposes:

| Endpoint | Result |
| --- | --- |
| `/` | Short text explaining the available endpoints |
| `/health` | Device identity, protocol, sensor status, station/AP addresses, hotspot connection status, uptime and ports |
| `/telemetry` | A `DATA,...` measurement line, or HTTP 503 if no fresh measurement is available |

An illustrative network packet is:

```text
DATA,s1_mA=174.0,s2_mA=260.0,independent=1,boot=123456,seq=42
```

These numbers are examples, not readings promised by the hardware. `boot` changes on a restart; `seq` advances with measurements. Python ignores repeated copies of the same `(boot, seq)` pair so a cached HTTP response cannot repeatedly add energy or keep old data fresh.

Python polls an established target approximately every **0.7 seconds after each iteration**, subject to request time. It checks health as well as telemetry. The browser fetches `/api/dashboard` again approximately **two seconds after its previous request completes**.

Data older than approximately **four seconds** is no longer treated as fresh. The browser turns off active-room effects and changes circuit status to last-received/waiting as appropriate. Last numeric values can remain visible; use Debugging for their age and connection state.

A failed discovery is retried after about three seconds. In automatic discovery mode, three transport failures trigger another search. Sensor-status problems such as calibration do not mean that the network is disconnected; read the reported status. A manually specified `--device-url` keeps retrying that target instead of automatically choosing a different one.

## 9. Run a physical demonstration

Use this order so the team can check one layer at a time:

| Physical state | Expected result after filtering settles |
| --- | --- |
| Both circuits OFF | Both rooms dim; no active-zone callouts; current near zero or below detection |
| Only Zone A ON | Zone A brightens, its outside label appears, and Zone A/total readings increase |
| Only Zone B ON | Zone B brightens, its outside label appears, and Zone B/total readings increase |
| Both ON | Both rooms brighten, both labels appear, and the monitored total represents both zone loads |

Wait several seconds after operating a switch. The existing firmware has a noise floor, and Python uses an eight-sample average for this packet format. The display should not be expected to jump to a perfectly stable value instantly.

The room is fixed at a front-facing 45-degree elevation and fits its panel automatically. On small screens, active-zone callouts move above the model so text does not cover it. Flow dots indicate activity, not separately measured electrical direction or electrons.

Energy increases while accepted measurements indicate consumption. Turning circuits off stops new consumption after filtering settles; it does **not** reset accumulated energy or cost.

## 10. Preview the frontend without hardware

There are three distinct modes. Do not identify them only by visual appearance: the requested dashboard design no longer displays preview/simulation pills or a simulation banner.

| Mode | How to open it | Source of readings | Saved records |
| --- | --- | --- | --- |
| Live Wi-Fi or USB | Normal Python URL, without `?demo=1` or `--demo` | Physical ESP | SQLite `LIVE` records |
| Frontend preview | Open `templates/index.html` with VS Code Live Server, or add `?demo=1` to the Python URL | Browser-generated examples | No writes from this preview to SQLite/cloud |
| Python demo | Start `server.py --demo`, then use its normal URL without `?demo=1` | Python-generated measurements | Separate SQLite `DEMO` records |

### Frontend preview controls

Open **Preview controls** at the bottom-right. The menu starts closed, and Escape or an outside click closes it.

| Preset | Zone A example | Zone B example | Feeder example |
| --- | --- | --- | --- |
| Both off | 0 mA / 0 W | 0 mA / 0 W | 0 W |
| Zone A on | 174 mA / about 40.0 W | 0 mA / 0 W | about 40.0 W |
| Zone B on | 0 mA / 0 W | 260 mA / about 59.8 W | about 59.8 W |
| Both on | 174 mA / about 40.0 W | 260 mA / about 59.8 W | about 99.8 W |

These buttons change the browser's examples. They do not send switch commands to the ESP. **Pause flow** stops moving flow dots; it does not stop physical power consumption, data updates or energy accounting.

The frontend preview starts with example history, so energy/cost can already be nonzero when the page first opens. Refreshing resets this browser-only preview. Its CSV export contains preview history.

Example Python-served frontend preview URL:

```text
http://127.0.0.1:8765/?demo=1
```

Adding `?demo=1` affects the browser page only. It does not stop an already-running Python live collector in the background. Conversely, the Python `--demo` mode cycles its own example states; it does not use the browser's four-preset control menu unless you also open frontend preview.

For a quick source check, open **Debugging → Full server response**:

- Frontend preview reports `source: preview` and preview transport information.
- Python demo reports `mode: DEMO` and `connection: SIMULATION` while active.
- Physical operation reports `mode: LIVE` and the Wi-Fi or USB transport; fresh data reports `connection: CONNECTED`.

## 11. How measurements and costs are calculated

### Sensor channels and current

The firmware uses an **ADS1115**, not the ESP's built-in analog input:

| Firmware name | ADC channel | Intended signal |
| --- | --- | --- |
| `CH_SENSOR1` / `s1_mA` | Channel 0 | Zone A bulb current |
| `CH_SENSOR2` / `s2_mA` | Channel 1 | Zone B bulb current |

It calls `Wire.begin()` without a custom pin map and `ads.begin()` without a custom address. Confirm the selected board's I2C defaults and the physical ADC address with the hardware teammate. Channel 0/1 here refers to ADS1115 inputs, not ESP GPIO numbers.

Each measurement uses **80 samples per channel**. The baseline is subtracted, RMS counts are calculated, and the code converts the signal into current using its configured scale factors.

Current code values worth knowing:

| Constant | Value / purpose |
| --- | --- |
| ADC gain | `GAIN_TWO` |
| ADC data rate | `RATE_ADS1115_860SPS` |
| `ADC_LSB_MV` | `0.0625` mV per count |
| `DIVIDER_FACTOR` | `2.0` |
| `SENSITIVITY` | `70.0` used by the calculation |
| `MIN_CURRENT_MA` | Values below `20.0` mA become zero in firmware |
| `S2_TRIM_MA` | `0.0` in the current sketch |

The calculation retains **70.0 mV/A** as an existing project tuning value requiring hardware/reference-meter confirmation. Match the scale to the actual ACS712 variant and divider; this guide does not certify measurement accuracy.

New firmware marks its packets with `independent=1`. Python uses each transmitted current directly, without the old eight-sample smoothing or the rule that suppressed one sensor when the other was zero. The firmware's 20 mA noise floor still applies independently to each sensor.

### Independent zones

Each ACS712 measures its own bulb/zone:

```text
Zone A current = sensor 1 current
Zone B current = sensor 2 current
Total estimated power = Zone A estimated power + Zone B estimated power
```

Sensor 2 may read more than sensor 1, or remain active when sensor 1 is zero. Neither case is a mismatch for separate loads. The firmware reports only the two RMS currents and packet metadata; it performs no theft calculation.

Update the sketch and Python together. Unmarked older packets keep their earlier feeder/branch interpretation, including its filtering and difference checks. Historical samples and cumulative energy are preserved rather than retroactively recalculated; new energy intervals are not integrated across a layout change.

### Power, energy and active-room thresholds

Python calculates:

```text
estimated watts = assumed voltage x current in mA / 1000
energy increment in Wh = average(previous watts, current watts) x elapsed seconds / 3600
```

Default assumed voltage is **230 V**, and the power-factor assumption is **1**. Neither mains voltage nor power factor is directly measured by this code. Loads with different power factors can therefore have a different real wattage from the displayed estimate.

Python uses the two currents and `config.json` to derive estimated power. The revised firmware does not send watt estimates. Neither ACS712 measures mains voltage or power factor.

Energy uses real elapsed time. Integration gaps longer than five seconds are dropped rather than filling a disconnection with assumed consumption. The first accepted measurement after a reset/reconnect establishes a new integration starting point.

Room lighting uses a threshold of the larger of the configured `active_current_ma` and the reading's tolerance. The default activity threshold is **35 mA**. A small nonzero current or cost increment does not necessarily mean the room crosses that visual threshold.

### Maharashtra energy-cost estimate

The default rate is **MSEDCL LT I(B) residential, first 100 monthly units**, effective **1 April 2026 through 31 March 2027**:

```text
Energy charge:    Rs 3.96 / kWh
Wheeling charge:  Rs 1.60 / kWh
Default rate:     Rs 5.56 / kWh

Estimated energy cost = recorded Wh / 1000 x configured rate
4 Wh / 1000 x 5.56 = Rs 0.02224
```

Source: [MERC tariff order dated 25 March 2026, page 95, published by Mahavitaran](https://www.mahadiscom.in/wp-content/uploads/2026/07/Tariff-Order_Case-No.-75-of-2025-dated-25th-March-2026.pdf#page=95). The official site's [tariff index](https://www.mahadiscom.in/en/consumer/tariff-details/) is the starting point for checking later revisions.

This is the cost of the **recorded energy at one assumed rate**, not a complete household bill. It does not calculate monthly household slabs automatically. Fixed charges, FAC, electricity duty/taxes and time-of-day adjustments are excluded. Higher monthly consumption, another distributor or a commercial connection needs the appropriate configured rate.

The cost rounds to three decimal places in the UI. Small consumption can therefore take time to change the displayed amount. Turning lamps off does not clear earlier energy or cost.

Reference components, source and validity dates live in `static/electricity-tariff.json`. Python's default uses that file, while `config.json` supplies the actual configured server rate. Frontend preview reads the JSON reference directly. A custom configured rate is labeled `custom`. Updating a configured rate revalues the displayed cumulative energy; it is not a historical billing ledger.

The rate link has the source and assumptions in its tooltip and opens the official order. The current HTML omits the separate cost-note paragraph, so do not expect a visible expiry banner: inspect the tooltip/Debugging data and review the reference before its validity ends. The project does not fetch new tariff rates automatically.

## 12. Configuration and run modes

### Main configuration

Current `config.json` defaults:

| Key | Default | Meaning |
| --- | --- | --- |
| `assumed_voltage_v` | `230.0` | Voltage used for estimated power |
| `tariff_inr_per_kwh` | `5.56` | Flat rate used to value recorded energy |
| `peak_demand_w` | `85.0` | Demand-meter threshold; not a hardware breaker setting |
| `quiet_start_hour` | `20` | Start of quiet hours, using the server's local clock |
| `quiet_end_hour` | `8` | End of quiet hours |
| `active_current_ma` | `35.0` | Minimum configured current for visual activity |
| `main_reference_gain` | `1.0` | Sensor 1 / Zone A correction multiplier (name retained for saved settings) |
| `branch_reference_gain` | `1.0` | Sensor 2 / Zone B correction multiplier (name retained for saved settings) |

Keep valid JSON: double-quoted keys, numeric values and no trailing comma. Stop the server before manually editing its settings, then restart it. Do not change gains merely to make readings look desirable; check against a trusted reference first.

### Scan configuration

Default `network_scan.json`:

```json
{
  "ranges": ["auto", "192.168.50.1/32"],
  "ports": [80, 8080, 8081],
  "timeout_seconds": 0.7,
  "workers": 24
}
```

For a known ESP address, a `/32` narrows discovery to one host:

```json
{
  "ranges": ["192.168.43.20/32"],
  "ports": [80, 8080, 8081],
  "timeout_seconds": 0.7,
  "workers": 24
}
```

That IP is only an example. Use the address actually reported by your ESP. Restart Python to force an immediate new discovery after editing the scan file; otherwise it is reloaded on the next automatic scan, not on every healthy packet.

Changing scan ports does not change the ESP's servers. If you change device ports, update the firmware and scan configuration together and reflash. Do not scan unrelated networks; keep discovery on the team's local setup.

### Useful commands

Run from the repository root. Replace the environment prefix with `python` only if dependencies are installed in that interpreter.

```powershell
# Normal live Wi-Fi auto-discovery
.\.venv\Scripts\python.exe server.py

# Known ESP endpoint, avoiding address discovery
.\.venv\Scripts\python.exe server.py --device-url http://192.168.50.1:8081/telemetry

# USB serial instead of Wi-Fi; replace COM3 with the actual port
.\.venv\Scripts\python.exe server.py --port COM3

# Backend-generated demo, with separate DEMO database records
.\.venv\Scripts\python.exe server.py --demo

# Do not open a browser automatically
.\.venv\Scripts\python.exe server.py --no-browser

# Try dashboard ports 9000 through 9010 instead of 8765 through 8775
.\.venv\Scripts\python.exe server.py --web-port 9000
```

Choose only one of `--port`, `--device-url` and `--demo`. Without those options, Wi-Fi scanning is the default.

The PowerShell launcher also accepts `-Port COM3`, `-DeviceUrl http://.../telemetry`, `-Demo` and `-WebPort 9000`. Use the same one-mode rule.

USB mode needs Serial Monitor closed because Python needs the COM port. Wi-Fi mode can receive data while Serial Monitor is open, although opening a serial connection can reset some boards and trigger baseline calibration again.

By default the web server binds to `127.0.0.1`, so the dashboard is available on the laptop itself. `--host 0.0.0.0` exposes it to the laptop's network; another device then needs the **laptop's LAN IP**, not `127.0.0.1`. The app has no login protection for its APIs, so use LAN exposure only on the team's trusted network. It is not needed for the normal setup.

## 13. Debugging and common failures

### Check the layers in this order

1. Does the ESP have power and finish boot/calibration?
2. Is the ADS1115 detected?
3. Is the laptop on the correct Wi-Fi?
4. Does the ESP's `/health` respond?
5. Is `/telemetry` producing changing sequence numbers?
6. Does Python show an identified target and fresh packet?
7. Is the browser using the Python live URL rather than frontend preview?

In the dashboard, select **Debugging**. It contains scan progress, recent URL attempts, device health, the last packet and the current API state. There are intentionally no device-status pills on the main dashboard.

### Manual checks on the ESP's direct Wi-Fi

Open these in a browser while connected to `GridScope-Setup`:

```text
http://192.168.50.1/health
http://192.168.50.1/telemetry
http://192.168.50.1:8080/health
http://192.168.50.1:8081/health
```

Or from PowerShell:

```powershell
Invoke-RestMethod http://192.168.50.1/health
(Invoke-WebRequest http://192.168.50.1/telemetry -UseBasicParsing).Content
```

To inspect Python's state, replace 8765 if its selected port differs:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/api/state
```

### Troubleshooting table

| Symptom | Check / next action |
| --- | --- |
| `wifi_config.h: No such file or directory` | Create the ignored header beside the `.ino`; see section 5. |
| `Adafruit_ADS1X15.h` missing | Install the Adafruit ADS1X15 library in Arduino IDE. |
| ESP8266 header missing or wrong architecture error | Install/select the ESP8266 platform and the matching board. |
| Upload fails or COM port is busy | Close Serial Monitor/USB-mode Python, check board/port and use a data cable. |
| Hotspot never connects | Check exact credentials and 2.4 GHz; reflash after changing the header. Try direct ESP Wi-Fi to isolate the problem. |
| `GridScope-Setup` shows no internet | Expected for a local device network; remain connected. |
| Every scan attempt fails | Check laptop Wi-Fi, hotspot client isolation and explicit address ranges. Try the fixed direct AP and manual `/health`. |
| HTTP responds but “not GridScope” | Another device/web server is at that URL, or the ESP has incompatible firmware. Check board identity/sketch. |
| `WAITING_FOR_RAILS` or `CALIBRATING` | Leave both circuits off and wait; do not restart during a normal countdown. |
| `ADS1115_NOT_FOUND` | The ESP's networking can work independently; check ADC power/I2C/address with the hardware teammate. |
| `READY` but telemetry is stale | Check that `seq` changes. Keep both circuits off if resetting the ESP for another calibration. |
| Serial Monitor shows data but dashboard does not | Serial and Wi-Fi are separate paths. Check Python's mode, its selected ESP endpoint and the browser URL. |
| Small readings show zero or rooms stay dim | Firmware/server filtering and the 35 mA activity threshold can suppress small loads. Compare the raw packet with processed values. |
| Zone B shows unresolved / sensor mismatch | Check that both the sketch and Python are updated and the packet contains `independent=1`. Older unmarked packets still use feeder/branch difference checks. |
| A switch change takes a few seconds to settle | Eight-sample smoothing and the two-second browser fetch interval are expected; wait before interpreting it as failure. |
| The page works without an ESP and has a preview menu | Check whether it is Live Server or has `?demo=1`. Use the normal Python URL for physical measurements. |
| Cost is tiny | Wh is divided by 1000 before applying a per-kWh rate. Four Wh is only 0.004 kWh. |
| Energy/cost already has a value | Live/backend-demo totals restore from their stored records; frontend preview seeds example history. |
| Cost says rate unavailable | Check that `/static/electricity-tariff.json` is present and reachable. Preview intentionally does not invent a fallback price. |
| Model is unavailable | Check browser WebGL support. The fallback diagram and readings should remain usable. |
| Old UI appears after a change | Press Ctrl+F5. If there is a script error, inspect the browser console and Debugging. |
| Preview buttons stop working after HTML cleanup | Check that JS is not writing to a removed required element. Optional cost-note/events sections are guarded, but required reading/control IDs must stay. |
| 8765 is occupied | Python selects another port through 8775; use the actual printed/opened address. |
| The browser cannot reach Python | Keep the server terminal open; use the actual selected port and inspect terminal errors. |
| `.venv` reports `No Python at ...` | Recreate the environment with an installed Python interpreter; see section 7. A copied `.venv` is not portable. |

## 14. Saved data, exports and optional cloud sync

### Local database

Python creates `energy.sqlite3` in the repository root. It stores measurements, accumulated energy and events. Live and backend-demo records use different `data_mode` values. The current UI shows charts and totals; events remain available in the database/API even though the recent-events dashboard section has been removed.

Energy is calculated on accepted packets, while sample records are written at most approximately once per second. A stop/restart restores the most recently stored totals for the selected mode. It is not a promise of recovering the last unrecorded fraction of a second after a sudden power loss.

Keep the terminal running while collecting. Before copying the database as a backup, stop the server cleanly. Do not delete or edit it to make a presentation's values look different without coordinating with the team.

### Exports

- Live/backend-demo **Export data** downloads the selected mode's stored sample rows from Python's `/api/export.csv`.
- Frontend-preview **Export data** builds a CSV from browser example history. It is not an export of physical measurements.

### Optional MongoDB

MongoDB is optional. Without `MONGODB_URI`, local collection and the dashboard still work.

The supported environment variables are:

```text
MONGODB_URI
MONGODB_DB   (default: energy_monitor)
```

Run `python configure_cloud.py` for hidden credential input and private `.env` setup; never put credentials in this guide or a committed file. `cloud.py` uses a transactional SQLite outbox and destination-scoped checkpoints. Unsent entries survive restarts, existing SQLite history is backfilled, and idempotent MongoDB upserts make partial batches safe to retry. Keep the entire SQLite database when backing up the gateway identity and upload state.

The local `/api/dashboard` always uses SQLite so an upload backlog cannot replace fresh local totals with older cloud totals. `/analytics` adds usage trends, energy deltas, estimated cost, circuit shares, recording coverage and CSV summaries. The separate hosted app reads device-scoped Atlas history and requires sign-in. Read [Cloud setup](docs/CLOUD_SETUP.md) for the Vercel environment, private configuration, access roles and end-to-end checks. Cloud and local cost estimates use the current configured rate.

## 15. Files and responsibilities

| File | Responsibility |
| --- | --- |
| `firmware/energy_wifi/energy_wifi.ino` | Boot, baseline calibration, ADC sampling, serial output and ESP HTTP endpoints |
| `firmware/energy_wifi/wifi_config.h` | Local private hotspot credentials; ignored by Git |
| `start_dashboard.cmd` | Windows double-click entry point |
| `run_windows.ps1` | Creates/uses `.venv`, installs dependencies and launches the selected mode |
| `requirements.txt` | Flask, pyserial and pymongo dependencies |
| `server.py` | Transport readers, data processing coordination, persistence and dashboard/API serving |
| `network_scan.py` | Local range discovery, bounded concurrent probes and device-identity checks |
| `network_scan.json` | Address ranges, ESP ports and probe limits |
| `energy_math.py` | Settings validation, telemetry parsing, current/power derivation and Wh integration |
| `config.json` | Server voltage, tariff, thresholds, quiet hours and gains |
| `static/electricity-tariff.json` | Official tariff reference, source and validity dates |
| `cloud.py` | Optional MongoDB connection, queue and reads |
| `templates/index.html` | Dashboard/debugging structure and preview controls |
| `static/dashboard.js` | API polling, readings, charts, page navigation and frontend preview |
| `static/dashboard.css` | Neutral dashboard theme, dark model panel and responsive layouts |
| `static/energy-scene.js` | Procedural 3D room, lighting, flow overlay and active-zone callouts |
| `static/vendor/` | Locally served Three.js modules and license |
| `energy.sqlite3` | Generated local data, ignored by Git |

The room renders in WebGL only when lighting or size changes. Its moving flow dots use a small 2D overlay rather than redrawing the whole lit room continuously. The final still image is supersampled, and shadows are cached. Labels use SVG and update their positions on resize. Avoid adding continuous full-scene rendering when refining the UI.

## 16. Team handoff and presentation checklist

### Before handing the project to another teammate

- Share the repository, including `static/vendor` and `static/electricity-tariff.json`.
- Tell them to create their own ignored `wifi_config.h`; do not assume Git included yours.
- Record the actual board model, COM port and verified hardware wiring separately.
- Explain which phone hotspot credentials were flashed and whether they need to reflash.
- Confirm the first boot with both circuits off and obtain `READY`.
- Check one physical ON/OFF sequence, not only the browser preview.
- Confirm whether MongoDB is being used; it is not required for the local demo.
- Review the MSEDCL tariff validity and the household-slab assumption before discussing cost accuracy.

### On presentation day

1. Install dependencies beforehand and keep a tested USB cable/power source available.
2. Keep both circuits off, power the rig and wait for calibration.
3. Connect to the planned hotspot; keep `GridScope-Setup` as the fallback.
4. Run `.\.venv\Scripts\python.exe server.py` after dependencies are prepared.
5. Use the actual browser URL opened by Python, without `?demo=1`.
6. Confirm `mode: LIVE`, fresh data and the intended transport in Debugging.
7. Demonstrate off, A-only, B-only and both-on, allowing filtering to settle.
8. Explain that watts/energy are current-based estimates and the cost excludes complete-bill extras.
9. Export physical data if needed, then stop Python with Ctrl+C.

If hardware cannot be used, deliberately choose frontend preview or backend demo and explain that choice to the audience. Those modes are useful for demonstrating the interface; they do not validate the physical measurement chain.
