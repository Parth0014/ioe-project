# ESP8266 USB serial firmware

The ESP8266 sends live readings directly to the computer over its USB serial
connection. The USB cable powers the board and carries data; no wireless setup
is used. A charge-only cable supplies power but cannot carry readings.

## Upload and start

1. In Arduino IDE, open `energy_usb/energy_usb.ino` and select the ESP8266
   board and its USB COM port.
2. Install the ESP8266 board package and Adafruit ADS1X15 library if needed,
   then upload the sketch.
3. Close Arduino Serial Monitor so Python can take control of the COM port.
4. Connect the ADS1115 and sensors, then run `python app.py` from the project
   root. If automatic port selection chooses the wrong serial device, specify
   it with `python app.py --port COM5`.
5. Keep both bulbs off during the firmware startup calibration.

The firmware communicates at **115200 baud**. Opening the serial port restarts
the ESP8266, which performs calibration before publishing readings. The board
prints `INFO:READY` when sampling is ready and then emits one `DATA,...` line
per measurement. If the ADS1115 is missing, it prints
`ERR:ADS1115_NOT_FOUND` and sends no fabricated readings.

## Sensor mapping

- ACS712 sensor 1, ADS1115 A0: Zone A bulb current.
- ACS712 sensor 2, ADS1115 A1: Zone B bulb current.
- Each channel is measured independently; one zero channel does not suppress
  the other.

The firmware calculates RMS current and applies the configured 20 mA cutoff.
Python maps currents to estimated watts and watt-hours using the configured
assumed voltage. This is an estimate, not revenue-grade real-power measurement.
Confirm the scale against the actual ACS712 variant and a reference meter.

## Troubleshooting

- No COM port: use a USB data cable and install the board's USB-to-serial
  driver (commonly CH340 or CP210x).
- Port is busy: close Serial Monitor and any other program using that port.
- `ADS1115_NOT_FOUND`: check converter power, SDA/SCL wiring and I2C address.
- No live readings: wait for `INFO:READY`, confirm the correct port in the
  dashboard's Debugging screen, then check the last serial packet.

