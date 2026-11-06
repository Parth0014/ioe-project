
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <math.h>

// =====================================================
// SERIAL CONFIGURATION
// =====================================================

// Match the Python serial reader; ROM boot messages still use 74880 baud.
#define BAUD_RATE       115200

// =====================================================
// HTTP SERVERS
// =====================================================

ESP8266WebServer http80(80);
ESP8266WebServer http8080(8080);
ESP8266WebServer http8081(8081);

const char* deviceStatus = "STARTING";

String latestTelemetry;

uint32_t bootId = 0;
uint32_t sampleSequence = 0;

bool sensorAvailable = false;

// =====================================================
// SENSOR CONFIGURATION
// =====================================================

#define SAMPLES         80
#define CAL_SAMPLES     400

#define ADC_LSB_MV      0.0625f
#define SENSITIVITY     70.0f
#define DIVIDER_FACTOR  2.0f

#define MIN_CURRENT_MA  20.0f
#define S2_TRIM_MA      0.0f

#define CH_SENSOR1        0
#define CH_SENSOR2        1

#define YIELD_EVERY     50

Adafruit_ADS1115 ads;

float baseline_sensor1 = 0.0f;
float baseline_sensor2 = 0.0f;

// =====================================================
// WIFI CLIENT HANDLING
// =====================================================

void serveWifi() {
  http80.handleClient();
  http8080.handleClient();
  http8081.handleClient();

  yield();
}

// =====================================================
// HTTP ENDPOINTS
// =====================================================

void startHttp(ESP8266WebServer& server) {

  ESP8266WebServer* endpoint = &server;

  server.on("/health", HTTP_GET, [endpoint]() {

    String body = "{\"device\":\"GridScope\",";
    body += "\"protocol\":1,";
    body += "\"sensor_layout\":\"independent\",";
    body += "\"status\":\"";
    body += deviceStatus;
    body += "\",\"transport\":\"Wi-Fi AP\",";
    body += "\"ip\":\"192.168.50.1\"}";

    endpoint->send(200, "application/json", body);
  });

  server.on("/telemetry", HTTP_GET, [endpoint]() {

    endpoint->sendHeader("Cache-Control", "no-store");

    if (latestTelemetry.length() == 0) {

      endpoint->send(503, "text/plain", deviceStatus);

    } else {

      endpoint->send(200, "text/plain", latestTelemetry);

    }
  });

  server.on("/", HTTP_GET, [endpoint]() {

    endpoint->send(
      200,
      "text/plain",
      "GridScope: /health for status; /telemetry for sensor readings. Keep both bulbs OFF during startup calibration."
    );

  });

  server.begin();
}

// =====================================================
// WIFI ACCESS POINT
// =====================================================

void startWifi() {

  bootId = ESP.getCycleCount() ^ micros();

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP);

  IPAddress ip(192, 168, 50, 1);

  if (
    !WiFi.softAPConfig(
      ip,
      ip,
      IPAddress(255, 255, 255, 0)
    ) ||
    !WiFi.softAP(
      "GridScope-Setup",
      "GridScope123"
    )
  ) {

    deviceStatus = "WIFI_START_FAILED";

    Serial.println("ERR:WIFI_START_FAILED");

    return;
  }

  startHttp(http80);
  startHttp(http8080);
  startHttp(http8081);

  Serial.println(
    "INFO:WIFI GridScope-Setup http://192.168.50.1/health"
  );
}

// =====================================================
// SENSOR BASELINE CALIBRATION
// =====================================================

void calibrateBaseline() {

  Serial.println("CAL:STARTED");

  for (int i = 0; i < 50; i++) {

    ads.readADC_SingleEnded(CH_SENSOR1);
    ads.readADC_SingleEnded(CH_SENSOR2);

    if (i % 10 == 0) {
      yield();
    }

    delay(5);
  }

  // SENSOR 1 BASELINE

  double sum_sensor1 = 0;

  for (int i = 0; i < CAL_SAMPLES; i++) {

    sum_sensor1 += ads.readADC_SingleEnded(CH_SENSOR1);

    delayMicroseconds(1200);

    if (i % YIELD_EVERY == 0) {
      serveWifi();
    }
  }

  baseline_sensor1 = sum_sensor1 / CAL_SAMPLES;

  // SENSOR 2 BASELINE

  double sum_sensor2 = 0;

  for (int i = 0; i < CAL_SAMPLES; i++) {

    sum_sensor2 += ads.readADC_SingleEnded(CH_SENSOR2);

    delayMicroseconds(1200);

    if (i % YIELD_EVERY == 0) {
      serveWifi();
    }
  }

  baseline_sensor2 = sum_sensor2 / CAL_SAMPLES;

  Serial.print("CAL:BASELINE,s1=");
  Serial.print(baseline_sensor1, 2);

  Serial.print(",s2=");
  Serial.println(baseline_sensor2, 2);
}

// =====================================================
// SENSOR READING AND TELEMETRY
// =====================================================

void readAndSend() {

  double sq_sensor1 = 0;
  double sq_sensor2 = 0;

  for (int i = 0; i < SAMPLES; i++) {

    float v_sensor1 =
      ads.readADC_SingleEnded(CH_SENSOR1) - baseline_sensor1;

    float v_sensor2 =
      ads.readADC_SingleEnded(CH_SENSOR2) - baseline_sensor2;

    sq_sensor1 += v_sensor1 * v_sensor1;
    sq_sensor2 += v_sensor2 * v_sensor2;

    delayMicroseconds(800);

    if (i % 10 == 0) {
      serveWifi();
    }
  }

  // RMS CALCULATION

  float rms_counts_sensor1 =
    sqrt(sq_sensor1 / SAMPLES);

  float rms_counts_sensor2 =
    sqrt(sq_sensor2 / SAMPLES);

  // COUNTS TO MILLIVOLTS

  float rms_mV_sensor1 =
    rms_counts_sensor1 * ADC_LSB_MV;

  float rms_mV_sensor2 =
    rms_counts_sensor2 * ADC_LSB_MV;

  // MILLIVOLTS TO CURRENT

  float current_sensor1_mA =
    (rms_mV_sensor1 / SENSITIVITY)
    * 1000.0f
    * DIVIDER_FACTOR;

  float current_sensor2_mA =
    (rms_mV_sensor2 / SENSITIVITY)
    * 1000.0f
    * DIVIDER_FACTOR;

  // NOISE FILTER

  if (current_sensor1_mA < MIN_CURRENT_MA) {
    current_sensor1_mA = 0;
  }

  if (current_sensor2_mA < MIN_CURRENT_MA) {
    current_sensor2_mA = 0;
  }

  // SENSOR TRIM

  current_sensor2_mA =
    max(0.0f, current_sensor2_mA - S2_TRIM_MA);

  // TELEMETRY GENERATION

  latestTelemetry =
    "DATA,s1_mA=" + String(current_sensor1_mA, 1);

  latestTelemetry +=
    ",s2_mA=" + String(current_sensor2_mA, 1);

  // Each ACS712 measures one separate zone; neither reading is a difference.
  latestTelemetry += ",independent=1";

  latestTelemetry +=
    ",boot=" + String(bootId);

  latestTelemetry +=
    ",seq=" + String(++sampleSequence);

  Serial.println(latestTelemetry);
}

// =====================================================
// SETUP
// =====================================================

void setup() {

  // SERIAL INITIALIZATION

  Serial.begin(BAUD_RATE);

  delay(500);

  Serial.println();
  Serial.println("================================");
  Serial.println(" GRIDSCOPE APPLICATION STARTED ");
  Serial.println("================================");

  Serial.println("INFO:BOOT");
  Serial.print("INFO:SERIAL_BAUD=");
  Serial.println(BAUD_RATE);
  Serial.println("INFO:SENSORS S1=Zone A, S2=Zone B (independent RMS current)");

  // WIFI INITIALIZATION

  startWifi();

  deviceStatus = "CALIBRATING";

  // I2C INITIALIZATION

  Wire.begin();

  // ADS1115 CONFIGURATION

  ads.setGain(GAIN_TWO);
  ads.setDataRate(RATE_ADS1115_860SPS);

  if (!ads.begin()) {

    deviceStatus = "ADS1115_NOT_FOUND";

    Serial.println("ERR:ADS1115_NOT_FOUND");

    return;
  }

  sensorAvailable = true;

  Serial.println("INFO:ADS1115_DETECTED");

  Serial.println("CAL:WAITING_FOR_RAILS");

  // CALIBRATION COUNTDOWN

  for (int i = 5; i > 0; i--) {

    Serial.print("CAL:COUNTDOWN,");
    Serial.println(i);

    for (int tick = 0; tick < 100; tick++) {

      delay(10);
      serveWifi();
    }
  }

  // BASELINE CALIBRATION

  calibrateBaseline();

  deviceStatus = "READY";

  Serial.println("INFO:READY");
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {

  serveWifi();

  if (sensorAvailable) {

    readAndSend();

  } else {

    delay(10);
  }

  yield();
}
