#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include "wifi_config.h"

ESP8266WebServer web(80);
ESP8266WebServer web8080(8080);
ESP8266WebServer web8081(8081);
ESP8266WebServer* servers[] = {&web, &web8080, &web8081};
String telemetry;
uint32_t sequence = 0;
uint32_t bootId = 0;
unsigned long lastMeasurement = 0;
bool wifiWasConnected = false;
String sensorStatus = "STARTING";
bool sensorAvailable = false;

void serviceNetwork() {
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wifiWasConnected) {
    Serial.print("WIFI:TELEMETRY_URL=http://");
    Serial.print(WiFi.localIP());
    Serial.println("/telemetry");
  }
  wifiWasConnected = connected;
  for (auto* server : servers) server->handleClient();
}

void startWebServers() {
  for (auto* server : servers) {
    server->on("/health", HTTP_GET, [server]() {
      String json = "{\"device\":\"GridScope\",\"protocol\":1,\"status\":\"" + sensorStatus
        + "\",\"station_ip\":\"" + WiFi.localIP().toString()
        + "\",\"ap_ip\":\"" + WiFi.softAPIP().toString()
        + "\",\"hotspot_connected\":" + (WiFi.status() == WL_CONNECTED ? "true" : "false")
        + ",\"uptime_seconds\":" + String(millis() / 1000)
        + ",\"ports\":[80,8080,8081]}";
      server->sendHeader("Cache-Control", "no-store");
      server->send(200, "application/json", json);
    });
    server->on("/telemetry", HTTP_GET, [server]() {
      server->sendHeader("Cache-Control", "no-store");
      if (telemetry.length() == 0 || millis() - lastMeasurement > 3000) {
        server->send(503, "text/plain", sensorStatus + ": waiting for a fresh measurement");
      } else {
        server->send(200, "text/plain", telemetry);
      }
    });
    server->on("/", HTTP_GET, [server]() {
      server->send(200, "text/plain", "GridScope ESP8266. Open /health for diagnostics or /telemetry for readings. Ports: 80, 8080, 8081.");
    });
    server->begin();
  }
}

#define BAUD_RATE       115200

// ── Sampling ─────────────────────────────────────────────
#define SAMPLES         80
#define CAL_SAMPLES     400

// ── ADC + Sensor Config ─────────────────────────────────
#define ADC_LSB_MV      0.0625f    // GAIN_TWO → 0.0625 mV per count
#define SENSITIVITY     70.0f     // ACS712-20A → 100 mV/A
#define DIVIDER_FACTOR  2.0f       // 10k + 10k divider

// ── Power ───────────────────────────────────────────────
#define MAINS_VOLTS     230.0f

// ── Noise + tuning ─────────────────────────────────────
#define MIN_CURRENT_MA  20.0f
#define S2_TRIM_MA      0.0f

#define CH_TOTAL        0
#define CH_LEGAL        1
#define YIELD_EVERY     50

Adafruit_ADS1115 ads;

float baseline_total = 0.0f;
float baseline_legal = 0.0f;

// ───────────────────────────────────────────────────────
void calibrateBaseline() {
  sensorStatus = "CALIBRATING: keep both bulbs OFF";
  Serial.println("CAL:STARTED");

  for (int i = 0; i < 50; i++) {
    ads.readADC_SingleEnded(CH_TOTAL);
    ads.readADC_SingleEnded(CH_LEGAL);
    if (i % 10 == 0) { serviceNetwork(); yield(); }
    delay(5);
  }

  double sum_total = 0;
  for (int i = 0; i < CAL_SAMPLES; i++) {
    sum_total += ads.readADC_SingleEnded(CH_TOTAL);
    delayMicroseconds(1200);
    if (i % YIELD_EVERY == 0) { serviceNetwork(); yield(); }
  }
  baseline_total = sum_total / CAL_SAMPLES;

  double sum_legal = 0;
  for (int i = 0; i < CAL_SAMPLES; i++) {
    sum_legal += ads.readADC_SingleEnded(CH_LEGAL);
    delayMicroseconds(1200);
    if (i % YIELD_EVERY == 0) { serviceNetwork(); yield(); }
  }
  baseline_legal = sum_legal / CAL_SAMPLES;

  Serial.print("CAL:BASELINE,total=");
  Serial.print(baseline_total, 2);
  Serial.print(",legal=");
  Serial.println(baseline_legal, 2);
}

// ───────────────────────────────────────────────────────
void readAndSend() {

  double sq_total = 0, sq_legal = 0;

  for (int i = 0; i < SAMPLES; i++) {
    float v_total = ads.readADC_SingleEnded(CH_TOTAL) - baseline_total;
    float v_legal = ads.readADC_SingleEnded(CH_LEGAL) - baseline_legal;

    sq_total += v_total * v_total;
    sq_legal += v_legal * v_legal;

    delayMicroseconds(800);
  }

  float rms_counts_total = sqrt(sq_total / SAMPLES);
  float rms_counts_legal = sqrt(sq_legal / SAMPLES);

  // ── Convert counts → mV ───────────────────────────────
  float rms_mV_total = rms_counts_total * ADC_LSB_MV;
  float rms_mV_legal = rms_counts_legal * ADC_LSB_MV;

  // ── Convert mV → Current ──────────────────────────────
  float current_total_mA = (rms_mV_total / SENSITIVITY) * 1000.0f * DIVIDER_FACTOR;
  float current_legal_mA = (rms_mV_legal / SENSITIVITY) * 1000.0f * DIVIDER_FACTOR;

  // ── Noise filter ──────────────────────────────────────
  if (current_total_mA < MIN_CURRENT_MA) current_total_mA = 0;
  if (current_legal_mA < MIN_CURRENT_MA) current_legal_mA = 0;

  // ── Trim mismatch ─────────────────────────────────────
  current_legal_mA = max(0.0f, current_legal_mA - S2_TRIM_MA);

  // ── Power calculation ─────────────────────────────────
  float watts_total = (current_total_mA / 1000.0f) * MAINS_VOLTS;
  float watts_legal = (current_legal_mA / 1000.0f) * MAINS_VOLTS;

  float theft_mA = max(0.0f, current_total_mA - current_legal_mA);
  float theft_W  = (theft_mA / 1000.0f) * MAINS_VOLTS;

  // ── Output ────────────────────────────────────────────
  Serial.print("DATA,s1_mA="); Serial.print(current_total_mA, 1);
  Serial.print(",s2_mA=");     Serial.print(current_legal_mA, 1);
  Serial.print(",s1_W=");      Serial.print(watts_total, 1);
  Serial.print(",s2_W=");      Serial.print(watts_legal, 1);
  Serial.print(",theft_mA=");  Serial.print(theft_mA, 1);
  Serial.print(",theft_W=");   Serial.println(theft_W, 1);
  telemetry = "DATA,s1_mA=" + String(current_total_mA, 1)
    + ",s2_mA=" + String(current_legal_mA, 1)
    + ",s1_W=" + String(watts_total, 1)
    + ",s2_W=" + String(watts_legal, 1)
    + ",boot=" + String(bootId) + ",seq=" + String(++sequence);
  lastMeasurement = millis();
}

// ───────────────────────────────────────────────────────
void setup() {
  Serial.begin(BAUD_RATE);
  bootId = ESP.random();
  WiFi.persistent(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(IPAddress(192, 168, 50, 1), IPAddress(192, 168, 50, 1), IPAddress(255, 255, 255, 0));
  if (!WiFi.softAP("GridScope-Setup", "GridScope123")) {
    Serial.println("ERR:DIRECT_WIFI_START_FAILED");
  }
  Serial.println("WIFI:DIRECT=GridScope-Setup IP=192.168.50.1 PORTS=80,8080,8081");
  WiFi.hostname("gridscope");
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("WIFI:CONNECTING (use a 2.4 GHz hotspot)");
  startWebServers();
  Wire.begin();

  ads.setGain(GAIN_TWO);   // 🔥 correct for small signal
  ads.setDataRate(RATE_ADS1115_860SPS);

  if (!ads.begin()) {
    sensorStatus = "ERROR: ADS1115_NOT_FOUND. Check ADC power and I2C wiring";
    Serial.println("ERR:ADS1115_NOT_FOUND");
    return; // Keep health endpoints reachable so the laptop can show this error.
  }
  sensorAvailable = true;

  Serial.println("CAL:WAITING_FOR_RAILS");
  sensorStatus = "WAITING_FOR_RAILS: keep both bulbs OFF";

  for (int i = 5; i > 0; i--) {
    Serial.print("CAL:COUNTDOWN,");
    Serial.println(i);
    for (int tick = 0; tick < 100; tick++) { serviceNetwork(); delay(10); }
  }

  calibrateBaseline();
  sensorStatus = "READY";
  Serial.println("INFO:READY");
}

// ───────────────────────────────────────────────────────
void loop() {
  serviceNetwork();
  if (sensorAvailable) readAndSend();
  else delay(10);
  serviceNetwork();
  yield();
}
