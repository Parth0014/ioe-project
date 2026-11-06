
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <math.h>

// =====================================================
// SERIAL CONFIGURATION
// =====================================================

// Match the Python serial reader; ROM boot messages still use 74880 baud.
#define BAUD_RATE       115200

uint32_t bootId = 0;
uint32_t sampleSequence = 0;
String telemetryLine;

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
// Keep the ESP8266 responsive while sampling and calibrating.
// =====================================================

void keepResponsive() {
  yield();
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
      keepResponsive();
    }
  }

  baseline_sensor1 = sum_sensor1 / CAL_SAMPLES;

  // SENSOR 2 BASELINE

  double sum_sensor2 = 0;

  for (int i = 0; i < CAL_SAMPLES; i++) {

    sum_sensor2 += ads.readADC_SingleEnded(CH_SENSOR2);

    delayMicroseconds(1200);

    if (i % YIELD_EVERY == 0) {
      keepResponsive();
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
      keepResponsive();
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

  telemetryLine =
    "DATA,s1_mA=" + String(current_sensor1_mA, 1);

  telemetryLine +=
    ",s2_mA=" + String(current_sensor2_mA, 1);

  // Each ACS712 measures one separate zone; neither reading is a difference.
  telemetryLine += ",independent=1";

  telemetryLine +=
    ",boot=" + String(bootId);

  telemetryLine +=
    ",seq=" + String(++sampleSequence);

  Serial.println(telemetryLine);
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

  bootId = ESP.getCycleCount() ^ micros();

  // I2C INITIALIZATION

  Wire.begin();

  // ADS1115 CONFIGURATION

  ads.setGain(GAIN_TWO);
  ads.setDataRate(RATE_ADS1115_860SPS);

  if (!ads.begin()) {

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
      keepResponsive();
    }
  }

  // BASELINE CALIBRATION

  calibrateBaseline();

  Serial.println("INFO:READY");
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {

  if (sensorAvailable) {

    readAndSend();

  } else {

    delay(10);
  }

  yield();
}
