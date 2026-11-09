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

#define ADC_LSB_MV      0.0625f   // GAIN_TWO: 0.0625 mV per count
#define SENSITIVITY     100.0f    // ACS712-20A = 100 mV/A (5A = 185, 30A = 66)
#define DIVIDER_FACTOR  2.0f      // 10k + 10k divider

#define MIN_CURRENT_MA  50.0f     // noise gate; tune after re-recording idle
#define S2_TRIM_MA      0.0f

// Set to 1 if "Zone A" bulb shows up on S2 and "Zone B" on S1
// (this is how your 9 Nov recording looked).
#define SWAP_SENSORS    0

#if SWAP_SENSORS
  #define CH_SENSOR1    1
  #define CH_SENSOR2    0
#else
  #define CH_SENSOR1    0
  #define CH_SENSOR2    1
#endif

#define YIELD_EVERY     50

Adafruit_ADS1115 ads;

// Kept for the CAL:BASELINE handshake / diagnostics only.
// RMS below no longer depends on these.
float baseline_sensor1 = 0.0f;
float baseline_sensor2 = 0.0f;

// =====================================================
// Keep the ESP8266 responsive while sampling and calibrating.
// =====================================================

void keepResponsive() {
  yield();
}

// =====================================================
// SENSOR BASELINE (diagnostic only)
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

  double sum_sensor1 = 0;

  for (int i = 0; i < CAL_SAMPLES; i++) {

    sum_sensor1 += ads.readADC_SingleEnded(CH_SENSOR1);

    delayMicroseconds(1200);

    if (i % YIELD_EVERY == 0) {
      keepResponsive();
    }
  }

  baseline_sensor1 = sum_sensor1 / CAL_SAMPLES;

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

  // Per-window mean-subtracted RMS:
  // rms = sqrt( mean(x^2) - mean(x)^2 )
  // Removes DC offset / zero-point drift automatically.
  double sum1 = 0, sq1 = 0;
  double sum2 = 0, sq2 = 0;

  for (int i = 0; i < SAMPLES; i++) {

    float x1 = ads.readADC_SingleEnded(CH_SENSOR1);
    float x2 = ads.readADC_SingleEnded(CH_SENSOR2);

    sum1 += x1;
    sq1  += (double)x1 * x1;

    sum2 += x2;
    sq2  += (double)x2 * x2;

    delayMicroseconds(800);

    if (i % 10 == 0) {
      keepResponsive();
    }
  }

  double mean1 = sum1 / SAMPLES;
  double mean2 = sum2 / SAMPLES;

  double var1 = sq1 / SAMPLES - mean1 * mean1;
  double var2 = sq2 / SAMPLES - mean2 * mean2;

  if (var1 < 0) var1 = 0;
  if (var2 < 0) var2 = 0;

  float rms_counts_sensor1 = sqrt(var1);
  float rms_counts_sensor2 = sqrt(var2);

  // COUNTS TO MILLIVOLTS

  float rms_mV_sensor1 = rms_counts_sensor1 * ADC_LSB_MV;
  float rms_mV_sensor2 = rms_counts_sensor2 * ADC_LSB_MV;

  // MILLIVOLTS TO CURRENT

  float current_sensor1_mA =
    (rms_mV_sensor1 / SENSITIVITY) * 1000.0f * DIVIDER_FACTOR;

  float current_sensor2_mA =
    (rms_mV_sensor2 / SENSITIVITY) * 1000.0f * DIVIDER_FACTOR;

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

  Wire.begin();

  ads.setGain(GAIN_TWO);
  ads.setDataRate(RATE_ADS1115_860SPS);

  if (!ads.begin()) {

    Serial.println("ERR:ADS1115_NOT_FOUND");

    return;
  }

  sensorAvailable = true;

  Serial.println("INFO:ADS1115_DETECTED");

  Serial.println("CAL:WAITING_FOR_RAILS");

  for (int i = 5; i > 0; i--) {

    Serial.print("CAL:COUNTDOWN,");
    Serial.println(i);

    for (int tick = 0; tick < 100; tick++) {

      delay(10);
      keepResponsive();
    }
  }

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