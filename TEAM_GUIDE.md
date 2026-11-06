# GridScope team guide

This guide covers the USB-connected ESP8266, sensor setup, dashboard startup,
measurement limits, saved data and recovery. The ESP uses USB serial for both
power and telemetry; the project does not require a wireless network.

## System overview

```text
Zone A bulb -> ACS712 -> ADS1115 A0 --+
                                      +-> ESP8266 -- USB serial --> Python service
Zone B bulb -> ACS712 -> ADS1115 A1 --+                          |-> SQLite
                                                                 |-> Browser
```

The browser talks to the Python service on the same computer. The service reads
the ESP's serial output, calculates power and energy estimates, stores readings
in SQLite and serves the dashboard. The dashboard observes the physical loads;
it does not switch them.

## What you need

- ESP8266 development board with a working USB-to-serial interface.
- USB **data** cable. A charge-only cable powers the board but cannot transfer
  sensor readings.
- ADS1115 ADC and two ACS712 sensors, wired for the chosen sensor voltage and
  the board's ADC input range.
- Computer with Python and the project dependencies installed.
- Arduino IDE, ESP8266 board support and Adafruit ADS1X15 library for flashing.

Sensor and mains wiring can be hazardous. Disconnect power before changing
wiring. Keep mains conductors insulated and enclosed, and have a qualified
person review the physical setup. The firmware is not a protection device.

## Flash the firmware

1. Open `firmware/energy_usb/energy_usb.ino` in Arduino IDE.
2. Install/select the ESP8266 board package and install Adafruit ADS1X15.
3. Connect the board with a USB data cable, select its COM port under
   **Tools → Port**, and upload.
4. Keep both bulbs off during startup calibration.

The firmware uses **115200 baud**. Opening a serial port resets the ESP8266.
During boot it reports startup, ADS1115 detection and calibration progress.
`INFO:READY` means sampling has begun. If the converter is not found, it prints
`ERR:ADS1115_NOT_FOUND` and does not invent readings.

## Start the service

From a new VS Code integrated terminal in the project root, run:

```powershell
python app.py
```

No environment activation or wireless setup is needed. The app automatically
uses the project's Python environment. It tries to select the ESP serial port;
if more than one serial device is attached, choose the board explicitly:

```powershell
python app.py --port COM5
```

Find the correct COM port under **Tools → Port** in Arduino IDE or in Windows
Device Manager. Close Arduino Serial Monitor before running the service because
only one program can own a COM port at a time. The service opens the dashboard
in your browser and prints its local URL. Keep the terminal open while
collecting. Press Ctrl+C to stop.

The dashboard normally tries ports 8765 through 8775. If that range is busy,
choose a different starting port, for example `python app.py --web-port 9000`.
For a clearly labelled software-only demonstration, run `python app.py --demo`.
Demo readings are not physical measurements.

## First boot and live operation

1. Connect the ADS1115 and sensors with board power disconnected.
2. Connect the ESP8266 to the computer over USB.
3. Leave both monitored bulbs off during baseline calibration.
4. Start `python app.py`; opening the COM port restarts the board.
5. Wait for `INFO:READY` in the dashboard's Debugging view and for live
   readings to appear.
6. Change one physical circuit at a time and compare Zone A and Zone B.

If you need to reflash, stop Python first. After the upload, close Serial Monitor
and restart Python so it can reconnect to the board.

## Debugging

- **No COM port appears:** confirm the cable supports data. Some ESP8266 boards
  need a CH340 or CP210x USB-to-serial driver.
- **Port is busy:** close Serial Monitor and other serial tools.
- **Connected but no readings:** wait for calibration to finish; check the
  Debugging screen's selected port, connection status and last packet.
- **`ADS1115_NOT_FOUND`:** the serial connection is working; check converter
  power, SDA/SCL connections and address.
- **Noisy or unexpectedly small values:** compare the raw packet with the
  processed values and verify the ACS712 variant and sensor wiring.
- **Board restarts when Python starts:** this is expected when the serial port
  opens. Keep both bulbs off so the new calibration captures a no-load baseline.

## Measurement behavior and limits

- ACS712 sensor 1 on ADS1115 A0 measures Zone A current.
- ACS712 sensor 2 on ADS1115 A1 measures Zone B current independently.
- Firmware calculates RMS current and applies a 20 mA cutoff. One zone reading
  can be zero while the other is active.
- Python estimates watts from RMS current and the configured assumed voltage;
  watt-hours accumulate from accepted readings. This is not a true-power meter
  and is not revenue-grade. Confirm the scale with the actual sensors and a
  trusted reference meter before relying on the numbers.
- Existing database history is retained across restarts. Settings changes do
  not recalculate old records.

## Local data and optional cloud copy

`energy.sqlite3` stores readings locally in the project root. The dashboard and
`/analytics` page read this local history and work without internet. The
optional MongoDB copy uses `MONGODB_URI` from the ignored `.env` file; use
`python configure_cloud.py` to configure it without placing credentials in a
command line or tracked file. Cloud upload needs internet access from the
computer; it is separate from ESP telemetry.

Export recorded rows with **Export data** in the dashboard. Stop the service
before copying the SQLite database for backup.

## Team handoff checklist

- Share the project including `firmware/energy_usb/energy_usb.ino` and local
  static assets.
- Record the actual board model, COM port and verified sensor wiring.
- Bring a known USB data cable and confirm the driver on the presentation
  computer before the demo.
- Close Serial Monitor, start the service, wait for fresh live readings, then
  demonstrate both zones individually and together.
- Label software demo data clearly if the physical sensor rig is unavailable.
- Explain that power and cost figures are estimates based on current and
  configured assumptions.

