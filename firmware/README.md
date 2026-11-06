# ESP8266 Wi-Fi firmware

The sketch creates its own Wi-Fi network before checking the ADS1115. USB supplies power and remains available for optional serial diagnostics.

## Connect and run

1. Keep both bulbs OFF during power-up and calibration.
2. Upload `energy_wifi/energy_wifi.ino` with the ESP8266 board package and Adafruit ADS1X15 dependencies installed.
3. Connect the laptop to **GridScope-Setup**, password **GridScope123**. Choose to stay connected if Windows warns that there is no internet.
4. Open **http://192.168.50.1/health**. The status is `CALIBRATING`, `READY`, or `ADS1115_NOT_FOUND`. With no ADC connected, the hotspot and health endpoint still work; readings are unavailable.
5. From the project root run `.\.venv-cloud\Scripts\python.exe server.py` for existing network discovery, then open the dashboard URL printed in the terminal. Do not use `--port` for Wi-Fi mode.

The ESP serves `/`, `/health` and `/telemetry` on ports **80, 8080 and 8081**. `/telemetry` returns HTTP 503 until a real measurement exists. Each DATA measurement includes boot and sequence IDs so repeated HTTP requests do not count cached readings as new samples. The application serial baud is **115200**.

## Independent zone currents

- ACS712 sensor 1, ADS1115 **A0**: current consumed by the **Zone A bulb**.
- ACS712 sensor 2, ADS1115 **A1**: current consumed by the **Zone B bulb**.
- Each sensor measures a separate load. A zero on one channel does not suppress the other.

The current-only packet is:

```text
DATA,s1_mA=175.0,s2_mA=260.0,independent=1,boot=123456,seq=42
```

The sketch calculates each sensor's RMS current independently. It does not
subtract sensors or report theft. Python maps S1 to Zone A and S2 to Zone B,
then estimates zone watts/Wh using its configured assumed voltage. Update the
sketch and Python server together; unmarked older packets keep their original
feeder/branch mapping. Previously recorded history is not recalculated.

Calibration uses both bulbs OFF and a separate baseline for each sensor.
The existing sensitivity (70 mV/A), divider compensation (2.0), ADC gain and
20 mA cutoff remain unchanged. These are project settings, not a certification
of sensor accuracy; verify the scale against the actual ACS712 variant and
reference measurements before relying on consumption estimates.

This direct hotspot does not join a phone hotspot or provide internet. It needs no private router credentials. Change the setup password in the sketch before use in a shared environment.

## Recovery

- No network named GridScope-Setup after a USB power cycle: startup is still failing; changing transport cannot fix a sketch that never starts.
- `ADS1115_NOT_FOUND`: power off before reconnecting ADC wiring, then reset with both bulbs OFF. No fabricated readings are published.
- Calibration runs at startup; keep loads off until `/health` reports READY. Dashboard calibration commands are not implemented; reset to recalibrate.
- USB boot text uses 74880 baud; sketch diagnostics use 115200.

These instructions supersede older firmware instructions about USB-only operation or phone-hotspot credentials. The root guides may describe an older station-mode firmware.
