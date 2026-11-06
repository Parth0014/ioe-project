import serial, time
PORT = "COM5"
for baud in (74880, 115200):
    s = serial.Serial()
    s.port, s.baudrate, s.timeout = PORT, baud, 0.2
    s.dtr = False
    s.rts = False
    s.open()
    print(f"\n--- {baud}: press the board's RST button now (8s) ---")
    t, buf = time.time(), b""
    while time.time() - t < 8:
        buf += s.read(256)
    s.close()
    txt = buf.decode("ascii", "replace")
    print(txt)
    print("boot banners:", txt.count("ets Jan"))