/*
  alzcare-watch.ino  —  COMBINED firmware for the AlzCare wearable
  ------------------------------------------------------------------
  Board:   ESP32-S3 (Waveshare ESP32-S3-Touch-LCD-1.47, ST7789 172x320)
  Does it all in one program:
    - LVGL Patient-Monitor UI on the LCD
    - MAX30102 heart-rate, QMI8658 IMU, NEO-6M GPS, BLE beacon scan (0x0505)
    - WiFi + TLS MQTT broadcast to HiveMQ Cloud as one combined ".../total" packet
    - BOOT-button SOS / "patient requests attention"

  This single sketch merges the two tabs of the original Waveshare project:
    * LVGL_Arduino.ino                    -> display bring-up + setup()/loop()
    * Watch_Code_Broadcast_LVGL_Module.ino-> sensors + WiFi + MQTT (Watch_Setup/Watch_Loop)
  The hardware/display DRIVERS stay as sibling .cpp/.h tabs in this same folder
  (Display_ST7789, LVGL_Driver, LVGL_Example, Gyro_QMI8658, I2C_Driver,
  BAT_Driver, Button_Driver, RGB_lamp, SD_Card, Simulated_Gesture, Wireless) and
  are compiled into THIS firmware by the Arduino build. See README.md for the
  required libraries, board settings, and lv_conf.h note.

  Data contract (server side): the protocol-shim subscribes to alzcare/+/+/total
  and resolves this device to its paired patient by "device_mac" in the payload.
  Pair the MAC below in the dashboard ("Set up hardware") before expecting data.
*/

// ---- Display / LVGL UI (drivers are sibling tabs in this folder) ----
#include "Display_ST7789.h"
#include "LVGL_Driver.h"
#include "LVGL_Example.h"

// ---- Sensors + connectivity ----
#include <WiFi.h>
#include <WiFiClientSecure.h>

#define MQTT_MAX_PACKET_SIZE 4096
#include <PubSubClient.h>

#include <TinyGPS++.h>
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include "BAT_Driver.h"

// ==========================================================================
//  Below: sensor + WiFi + MQTT logic, verbatim from
//  Watch_Code_Broadcast_LVGL_Module.ino (globals, BLE, HR, IMU, GPS, MQTT,
//  Watch_Setup(), Watch_Loop()). Unchanged.
// ==========================================================================

// Set true only when debugging individual BLE advertisement packets.
const bool VERBOSE_BLE_LOGS = false;
const bool VERBOSE_MQTT_PAYLOAD_LOGS = false;

#include "secrets.h"  // WiFi + MQTT credentials (gitignored; see secrets.example.h)

// ================= WiFi Settings =================
const char* ssid = SECRET_WIFI_SSID;
const char* password = SECRET_WIFI_PASS;

// ================= MQTT Settings =================
const char* MQTT_HOST = SECRET_MQTT_HOST;
const int MQTT_PORT = 8883;
const char* MQTT_USER = SECRET_MQTT_USER;
const char* MQTT_PASS = SECRET_MQTT_PASS;
const char* DEVICE_MAC = SECRET_DEVICE_MAC;  // paired to a patient in the dashboard
// The shim subscribes to alzcare/+/+/total and resolves the device to its
// patient by the device_mac in the payload — the site/patient segments here are
// just routing labels. (The old device/{mac}/telemetry topic is the BRIDGE's
// canonical topic and rejects this combined "total" format.)
const char* TOPIC = "alzcare/site1/patient001/total";
const char* STATUS_TOPIC = "device/" SECRET_DEVICE_MAC "/status";

WiFiClientSecure net;
PubSubClient client(net);

// ================= GPS Settings =================
#define GPS_RXD 44
#define GPS_TXD 43

TinyGPSPlus gps;
HardwareSerial neogps(1);

// ================= MAX30102 Settings =================
#define MAX_SDA 8
#define MAX_SCL 7

TwoWire MAXWire = TwoWire(0);
MAX30105 particleSensor;

const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;

float beatsPerMinute = 0;
int beatAvg = 0;
long irValue = 0;
bool maxOk = false;  // MAX30102 present & initialised
bool imuOk = false;  // QMI8658 present & initialised

// ================= QMI8658 IMU Settings =================
#define QMI8658_ADDR 0x6B
#define IMU_SDA 48
#define IMU_SCL 47

TwoWire IMUWire = TwoWire(1);

float ax_mps2 = 0;
float ay_mps2 = 0;
float az_mps2 = 0;
float gx_dps = 0;
float gy_dps = 0;
float gz_dps = 0;

// ================= BLE Scanner Settings =================
BLEScan* pBLEScan;
bool bleEnabled = false;  // true only if BLE init succeeds; gates the loop scan

#define TARGET_COMPANY_ID 0x0505
#define MAX_BLE_DEVICES 8

const float V_MAX = 4.2;
const float V_MIN = 3.3;

struct BLEDeviceData {
  String mac;
  int rssi;
  String rawManufacturerHex;
  uint16_t companyID;
  uint16_t rawADC;
  float voltage;
  int batteryPercent;
  unsigned long lastSeen;
  bool valid;
};

BLEDeviceData bleDevices[MAX_BLE_DEVICES];

// ================= Timing =================
unsigned long lastPublishTime = 0;
const unsigned long publishInterval = 1000;
unsigned long lastDisplayUpdateTime = 0;
const unsigned long displayUpdateInterval = 250;
unsigned long lastImuReadTime = 0;
const unsigned long imuReadInterval = 500;
unsigned long lastBatteryReadTime = 0;
const unsigned long batteryReadInterval = 1000;
unsigned long lastBleScanTime = 0;
const unsigned long bleScanInterval = 5000;
float localBatteryVolts = 0.0;
int localBatteryPercent = 0;
bool lastMqttPublishOk = false;
unsigned long lastMqttReconnectAttemptTime = 0;
const unsigned long mqttReconnectInterval = 15000;
const int BOOT_BUTTON_PIN = 0;
bool bootButtonWasPressed = false;
unsigned long sosPromptUntilTime = 0;
unsigned long sosConfirmedUntilTime = 0;
unsigned long lastBootPressTime = 0;
bool attentionRequestPending = false;

// ================= Utility: Convert Manufacturer Data to HEX =================
String manufacturerDataToHex(String data) {
  String hexString = "";

  for (int i = 0; i < data.length(); i++) {
    uint8_t value = (uint8_t)data.charAt(i);

    if (value < 16) {
      hexString += "0";
    }

    hexString += String(value, HEX);

    if (i < data.length() - 1) {
      hexString += " ";
    }
  }

  hexString.toUpperCase();
  return hexString;
}

// ================= BLE Device Storage =================
void updateBLEDevice(
  String mac,
  int rssi,
  String rawHex,
  uint16_t companyID,
  uint16_t rawADC,
  float voltage,
  int batteryPercent
) {
  int emptySlot = -1;
  int existingSlot = -1;

  for (int i = 0; i < MAX_BLE_DEVICES; i++) {
    if (bleDevices[i].valid && bleDevices[i].mac == mac) {
      existingSlot = i;
      break;
    }

    if (!bleDevices[i].valid && emptySlot == -1) {
      emptySlot = i;
    }
  }

  int slot = -1;

  if (existingSlot != -1) {
    slot = existingSlot;
  } else if (emptySlot != -1) {
    slot = emptySlot;
  } else {
    // If full, replace the oldest device
    unsigned long oldestTime = millis();
    int oldestSlot = 0;

    for (int i = 0; i < MAX_BLE_DEVICES; i++) {
      if (bleDevices[i].lastSeen < oldestTime) {
        oldestTime = bleDevices[i].lastSeen;
        oldestSlot = i;
      }
    }

    slot = oldestSlot;
  }

  bleDevices[slot].mac = mac;
  bleDevices[slot].rssi = rssi;
  bleDevices[slot].rawManufacturerHex = rawHex;
  bleDevices[slot].companyID = companyID;
  bleDevices[slot].rawADC = rawADC;
  bleDevices[slot].voltage = voltage;
  bleDevices[slot].batteryPercent = batteryPercent;
  bleDevices[slot].lastSeen = millis();
  bleDevices[slot].valid = true;
}

// ================= BLE Callback =================
class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) {
    if (!advertisedDevice.haveManufacturerData()) {
      return;
    }

    String mData = advertisedDevice.getManufacturerData();

    if (mData.length() < 4) {
      return;
    }

    // Company ID is little-endian:
    // byte 0 = low byte
    // byte 1 = high byte
    uint16_t companyID = ((uint8_t)mData.charAt(1) << 8) | (uint8_t)mData.charAt(0);

    if (companyID != TARGET_COMPANY_ID) {
      return;
    }

    // Raw ADC is also taken from bytes 2 and 3
    uint16_t rawADC = ((uint8_t)mData.charAt(3) << 8) | (uint8_t)mData.charAt(2);

    if (rawADC > 2047) {
      return;
    }

    int rssi = advertisedDevice.getRSSI();

    float voltage = rawADC * 0.00322019;

    int batteryPercent = constrain(
      ((voltage - V_MIN) / (V_MAX - V_MIN)) * 100.0,
      0,
      100
    );

    String rawHex = manufacturerDataToHex(mData);
    String mac = advertisedDevice.getAddress().toString().c_str();

    updateBLEDevice(
      mac,
      rssi,
      rawHex,
      companyID,
      rawADC,
      voltage,
      batteryPercent
    );

    if (VERBOSE_BLE_LOGS) {
      Serial.println("BLE 0x0505 DEVICE FOUND");
      Serial.print("MAC: ");
      Serial.println(mac);
      Serial.print("RSSI: ");
      Serial.println(rssi);
      Serial.print("Raw Manufacturer HEX: ");
      Serial.println(rawHex);
      Serial.print("Raw ADC: ");
      Serial.println(rawADC);
      Serial.print("Voltage: ");
      Serial.println(voltage, 3);
      Serial.print("Battery %: ");
      Serial.println(batteryPercent);
      Serial.println("--------------------------------");
    }
  }
};

// ================= WiFi Function =================
void setup_wifi() {
  Serial.print("Connecting to WiFi (non-blocking): ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);
  // Do NOT block here — the display + sensors must run regardless of
  // connectivity. WiFi associates in the background; loop()/reconnect()
  // pick it up once WL_CONNECTED, and the UI flips to "online" then.
}

// ================= MQTT Reconnect =================
void closeMqttSocket() {
  client.disconnect();
  net.stop();
  delay(200);
}

String mqttStateName(int state) {
  switch (state) {
    case MQTT_CONNECTION_TIMEOUT: return "CONNECTION_TIMEOUT";
    case MQTT_CONNECTION_LOST: return "CONNECTION_LOST";
    case MQTT_CONNECT_FAILED: return "CONNECT_FAILED";
    case MQTT_DISCONNECTED: return "DISCONNECTED";
    case MQTT_CONNECTED: return "CONNECTED";
    case MQTT_CONNECT_BAD_PROTOCOL: return "BAD_PROTOCOL";
    case MQTT_CONNECT_BAD_CLIENT_ID: return "BAD_CLIENT_ID";
    case MQTT_CONNECT_UNAVAILABLE: return "SERVER_UNAVAILABLE";
    case MQTT_CONNECT_BAD_CREDENTIALS: return "BAD_CREDENTIALS";
    case MQTT_CONNECT_UNAUTHORIZED: return "UNAUTHORIZED";
    default: return "UNKNOWN";
  }
}

void publishMqttStatus(const String& clientId) {
  String statusPayload = "{";
  statusPayload += "\"status\":\"online\",";
  statusPayload += "\"mqtt_host\":\"" + String(MQTT_HOST) + "\",";
  statusPayload += "\"mqtt_port\":" + String(MQTT_PORT) + ",";
  statusPayload += "\"client_id\":\"" + clientId + "\",";
  statusPayload += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  statusPayload += "\"uptime_ms\":" + String(millis());
  statusPayload += "}";

  bool ok = client.publish(STATUS_TOPIC, statusPayload.c_str(), true);
  Serial.print("MQTT status confirmation publish: ");
  Serial.println(ok ? "SUCCESS" : "FAILED");
  Serial.print("MQTT status topic: ");
  Serial.println(STATUS_TOPIC);
  Serial.print("MQTT status payload: ");
  Serial.println(statusPayload);
}

void reconnect() {
  if (client.connected()) {
    return;
  }

  // No WiFi yet → keep the display + sensors running; retry next loop
  // (WiFi auto-reconnects in the background).
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  // WiFi is up — throttle the heavier MQTT/TLS attempts.
  if (lastMqttReconnectAttemptTime != 0 && millis() - lastMqttReconnectAttemptTime < mqttReconnectInterval) {
    return;
  }

  lastMqttReconnectAttemptTime = millis();
  lastMqttPublishOk = false;

  closeMqttSocket();

  Serial.printf("[heap] free=%u  largest_block=%u\n", ESP.getFreeHeap(), ESP.getMaxAllocHeap());
  Serial.print("Connecting to MQTT host ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.print(MQTT_PORT);
  Serial.print(" ... ");

  String clientId = "ESP32S3-Hongting-Total-";
  clientId += String(random(0xffff), HEX);

  if (client.connect(
    clientId.c_str(),
    MQTT_USER,
    MQTT_PASS,
    STATUS_TOPIC,
    1,
    true,
    "{\"status\":\"offline\"}"
  )) {
    Serial.println("connected");
    Serial.print("MQTT connection confirmed. Client ID: ");
    Serial.println(clientId);
    publishMqttStatus(clientId);
  } else {
    int state = client.state();
    Serial.print("failed, rc=");
    Serial.print(state);
    Serial.print(" (");
    Serial.print(mqttStateName(state));
    Serial.println("). Will retry later; display remains live.");
    closeMqttSocket();
  }
}

// ================= MAX30102 Init =================
void setup_max30102() {
  Serial.println("Initializing MAX30102...");

  MAXWire.begin(MAX_SDA, MAX_SCL);

  if (!particleSensor.begin(MAXWire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found — continuing WITHOUT heart rate (status INVALID).");
    maxOk = false;
    return;
  }

  Serial.println("MAX30102 detected.");
  Serial.println("Place your finger on the sensor.");

  particleSensor.setup();
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);
  maxOk = true;
}

// ================= Read Heart Rate =================
void read_heart_rate() {
  if (!maxOk) return;  // sensor absent: leave irValue=0 so HR reads INVALID
  irValue = particleSensor.getIR();

  if (checkForBeat(irValue) == true) {
    long delta = millis() - lastBeat;
    lastBeat = millis();

    beatsPerMinute = 60 / (delta / 1000.0);

    if (beatsPerMinute < 255 && beatsPerMinute > 20) {
      rates[rateSpot++] = (byte)beatsPerMinute;
      rateSpot %= RATE_SIZE;

      beatAvg = 0;

      for (byte x = 0; x < RATE_SIZE; x++) {
        beatAvg += rates[x];
      }

      beatAvg /= RATE_SIZE;
    }
  }
}

// ================= IMU I2C Functions =================
void imuWriteRegister(uint8_t reg, uint8_t value) {
  IMUWire.beginTransmission(QMI8658_ADDR);
  IMUWire.write(reg);
  IMUWire.write(value);
  IMUWire.endTransmission();
}

uint8_t imuReadRegister(uint8_t reg) {
  IMUWire.beginTransmission(QMI8658_ADDR);
  IMUWire.write(reg);
  IMUWire.endTransmission(false);

  IMUWire.requestFrom(QMI8658_ADDR, 1);

  if (IMUWire.available()) {
    return IMUWire.read();
  }

  return 0x00;
}

void imuReadRegisters(uint8_t reg, uint8_t* buffer, uint8_t len) {
  IMUWire.beginTransmission(QMI8658_ADDR);
  IMUWire.write(reg);
  IMUWire.endTransmission(false);

  IMUWire.requestFrom(QMI8658_ADDR, len);

  for (int i = 0; i < len; i++) {
    if (IMUWire.available()) {
      buffer[i] = IMUWire.read();
    } else {
      buffer[i] = 0;
    }
  }
}

// ================= IMU Init =================
void setup_imu() {
  IMUWire.begin(IMU_SDA, IMU_SCL);

  Serial.println("Initializing QMI8658...");

  uint8_t whoami = imuReadRegister(0x00);

  Serial.print("WHO_AM_I = 0x");
  Serial.println(whoami, HEX);

  if (whoami != 0x05) {
    Serial.println("QMI8658 not detected — continuing WITHOUT IMU (status INVALID).");
    imuOk = false;
    return;
  }

  imuWriteRegister(0x02, 0x60);
  imuWriteRegister(0x03, 0x23);
  imuWriteRegister(0x04, 0x43);
  imuWriteRegister(0x08, 0x03);

  imuOk = true;
  Serial.println("QMI8658 initialized.");
}

// ================= Read IMU =================
void read_imu() {
  if (!imuOk) return;  // sensor absent: accel/gyro stay 0 and imu_status is INVALID
  uint8_t data[12];

  imuReadRegisters(0x35, data, 12);

  int16_t ax_raw = (data[1] << 8) | data[0];
  int16_t ay_raw = (data[3] << 8) | data[2];
  int16_t az_raw = (data[5] << 8) | data[4];

  int16_t gx_raw = (data[7] << 8) | data[6];
  int16_t gy_raw = (data[9] << 8) | data[8];
  int16_t gz_raw = (data[11] << 8) | data[10];

  ax_mps2 = (ax_raw / 4096.0) * 9.81;
  ay_mps2 = (ay_raw / 4096.0) * 9.81;
  az_mps2 = (az_raw / 4096.0) * 9.81;

  gx_dps = gx_raw / 64.0;
  gy_dps = gy_raw / 64.0;
  gz_dps = gz_raw / 64.0;
}

// ================= BLE Init =================
void setup_ble() {
  Serial.println("Initializing BLE scanner...");

  for (int i = 0; i < MAX_BLE_DEVICES; i++) {
    bleDevices[i].valid = false;
  }

  // NimBLE needs a big contiguous heap block. After WiFi+TLS the internal RAM
  // is tight; if it is too low, SKIP BLE instead of letting init hard-crash and
  // reboot the watch. HR/IMU/GPS/fall keep publishing; only positioning is lost.
  Serial.printf("[heap@ble] free=%u largest=%u\n", ESP.getFreeHeap(), ESP.getMaxAllocHeap());
  if (ESP.getMaxAllocHeap() < 80000) {
    Serial.println("BLE: heap too low — skipping scanner (positioning off, NO reboot).");
    bleEnabled = false;
    return;
  }

  BLEDevice::init("ESP32S3-MQTT-BLE-SCANNER");

  pBLEScan = BLEDevice::getScan();
  pBLEScan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks(), true);

  // Passive scan is usually better when you only need advertising data.
  pBLEScan->setActiveScan(false);

  // Scan interval/window
  pBLEScan->setInterval(150);
  pBLEScan->setWindow(120);

  // NOTE: do NOT scan continuously. A continuous scan pins the shared 2.4GHz
  // radio at ~80% duty and starves WiFi/TLS, which drops the MQTT connection
  // (the symptom: the broker's retained will flips to "offline"). We scan in
  // short bursts from loop() instead — see the publish cycle.

  bleEnabled = true;
  Serial.println("BLE scanner ready (periodic scan from loop).");
}

// ================= Build BLE JSON Array =================
String buildBLEJsonArray() {
  String json = "[";
  bool firstDevice = true;

  for (int i = 0; i < MAX_BLE_DEVICES; i++) {
    if (!bleDevices[i].valid) {
      continue;
    }

    if (!firstDevice) {
      json += ",";
    }

    firstDevice = false;

    json += "{";

    json += "\"mac_address\":\"";
    json += bleDevices[i].mac;
    json += "\",";

    json += "\"rssi\":";
    json += String(bleDevices[i].rssi);
    json += ",";

    json += "\"company_id\":\"0x";
    json += String(bleDevices[i].companyID, HEX);
    json += "\",";

    json += "\"raw_manufacturer_data\":\"";
    json += bleDevices[i].rawManufacturerHex;
    json += "\",";

    json += "\"raw_adc\":";
    json += String(bleDevices[i].rawADC);
    json += ",";

    json += "\"voltage\":";
    json += String(bleDevices[i].voltage, 3);
    json += ",";

    json += "\"battery_percent\":";
    json += String(bleDevices[i].batteryPercent);
    json += ",";

    json += "\"last_seen_ms_ago\":";
    json += String(millis() - bleDevices[i].lastSeen);

    json += "}";
  }

  json += "]";
  return json;
}

// ================= Count Valid BLE Devices =================
int countBLEDevices() {
  int count = 0;

  for (int i = 0; i < MAX_BLE_DEVICES; i++) {
    if (bleDevices[i].valid) {
      count++;
    }
  }

  return count;
}


// ================= LVGL UI Bridge =================
// Implemented in LVGL_Example.cpp. This only updates the screen and does not change
// WiFi, MQTT, GPS, MAX30102, IMU, or BLE functionality.
void PM_SetWatchData(
  double latitude,
  double longitude,
  int satellites,
  bool gps_valid,
  long ir_value,
  float bpm,
  int avg_bpm,
  bool finger_detected,
  float ax_mps2,
  float ay_mps2,
  float az_mps2,
  float gx_dps,
  float gy_dps,
  float gz_dps,
  int ble_device_count,
  bool mqtt_connected,
  bool last_publish_ok,
  float battery_volts,
  int battery_percent,
  bool sos_prompt_visible,
  bool attention_requested,
  bool sos_confirmed_visible
);

bool isSosPromptVisible() {
  return millis() < sosPromptUntilTime;
}

bool isSosConfirmedVisible() {
  return millis() < sosConfirmedUntilTime;
}

void handle_sos_button() {
  bool pressed = digitalRead(BOOT_BUTTON_PIN) == LOW;

  if (pressed && !bootButtonWasPressed && millis() - lastBootPressTime > 250) {
    lastBootPressTime = millis();

    if (isSosPromptVisible()) {
      attentionRequestPending = true;
      sosPromptUntilTime = 0;
      sosConfirmedUntilTime = millis() + 1500;
      lastPublishTime = 0;
      Serial.println("SOS confirmed: Patient Requests Attention");
    } else {
      sosPromptUntilTime = millis() + 5000;
      Serial.println("SOS prompt shown. Press BOOT again within 5 seconds to confirm.");
    }
  }

  bootButtonWasPressed = pressed;
}

int localBatteryPercentFromVolts(float volts) {
  return constrain(
    (int)(((volts - V_MIN) / (V_MAX - V_MIN)) * 100.0f + 0.5f),
    0,
    100
  );
}

void refresh_display_bridge() {
  if (millis() - lastBatteryReadTime >= batteryReadInterval || localBatteryVolts <= 0.01f) {
    lastBatteryReadTime = millis();
    localBatteryVolts = BAT_Get_Volts();
    localBatteryPercent = localBatteryPercentFromVolts(localBatteryVolts);
  }

  double latitude = 0.0;
  double longitude = 0.0;

  if (gps.location.isValid()) {
    latitude = gps.location.lat();
    longitude = gps.location.lng();
  }

  PM_SetWatchData(
    latitude,
    longitude,
    gps.satellites.value(),
    gps.location.isValid(),
    irValue,
    beatsPerMinute,
    beatAvg,
    irValue >= 50000,
    ax_mps2,
    ay_mps2,
    az_mps2,
    gx_dps,
    gy_dps,
    gz_dps,
    countBLEDevices(),
    client.connected(),
    lastMqttPublishOk,
    localBatteryVolts,
    localBatteryPercent,
    isSosPromptVisible(),
    attentionRequestPending,
    isSosConfirmedVisible()
  );
}

// ================= Setup =================
void Watch_Setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("ESP32-S3 TOTAL SENSOR MQTT SYSTEM STARTING");

  neogps.begin(9600, SERIAL_8N1, GPS_RXD, GPS_TXD);
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  BAT_Init();
  localBatteryVolts = BAT_Get_Volts();
  localBatteryPercent = localBatteryPercentFromVolts(localBatteryVolts);

  setup_max30102();
  setup_imu();

  setup_wifi();

  net.setInsecure();

  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setBufferSize(4096);
  client.setKeepAlive(60);
  client.setSocketTimeout(15);

  // BLE/positioning DISABLED for stability: NimBLE + WiFi/TLS together overflow
  // the ESP32-S3 internal RAM (BLE init crashed). With BLE off, MQTT/TLS connects
  // reliably from loop() once WiFi is up. Re-enable after moving buffers to PSRAM.
  // setup_ble();

  Serial.println("System ready.");
}

// ================= Main Loop =================
void Watch_Loop() {
  while (neogps.available() > 0) {
    gps.encode(neogps.read());
  }

  read_heart_rate();
  handle_sos_button();

  if (millis() - lastImuReadTime >= imuReadInterval) {
    lastImuReadTime = millis();
    read_imu();
  }

  if (millis() - lastDisplayUpdateTime >= displayUpdateInterval) {
    lastDisplayUpdateTime = millis();
    refresh_display_bridge();
  }

  reconnect();

  if (client.connected()) {
    client.loop();
  }

  if (millis() - lastPublishTime >= publishInterval) {
    lastPublishTime = millis();

    if (bleEnabled && millis() - lastBleScanTime >= bleScanInterval) {
      lastBleScanTime = millis();
      // Short BLE burst, then release the radio so WiFi/TLS stays stable.
      // Results accumulate in bleDevices[] while MQTT still publishes every second.
      pBLEScan->start(1, false);
      pBLEScan->clearResults();
    }

    double latitude = 0.0;
    double longitude = 0.0;
    String gps_status = "INVALID";

    if (gps.location.isValid()) {
      latitude = gps.location.lat();
      longitude = gps.location.lng();
      gps_status = "VALID";
    }

    String finger_status = "DETECTED";
    String heart_rate_status = "VALID";

    if (irValue < 50000) {
      finger_status = "NO_FINGER";
      heart_rate_status = "INVALID";
    }

    String payload = "{";

    payload += "\"patient_id\":\"001\",";

    // device_mac is how the shim maps this device to its paired patient.
    payload += "\"device_mac\":\"" + String(DEVICE_MAC) + "\",";

    // ================= GPS DATA =================
    payload += "\"gps_status\":\"" + gps_status + "\",";
    payload += "\"latitude\":";
    payload += String(latitude, 6);
    payload += ",";

    payload += "\"longitude\":";
    payload += String(longitude, 6);
    payload += ",";

    payload += "\"satellites\":";
    payload += String(gps.satellites.value());
    payload += ",";

    // ================= HEART RATE DATA =================
    payload += "\"heart_rate_status\":\"" + heart_rate_status + "\",";
    payload += "\"finger_status\":\"" + finger_status + "\",";
    payload += "\"ir_value\":";
    payload += String(irValue);
    payload += ",";

    payload += "\"bpm\":";
    payload += String(beatsPerMinute, 2);
    payload += ",";

    payload += "\"avg_bpm\":";
    payload += String(beatAvg);
    payload += ",";

    // ================= LOCAL BATTERY DATA =================
    payload += "\"device_battery_voltage\":";
    payload += String(localBatteryVolts, 2);
    payload += ",";

    payload += "\"device_battery_percent\":";
    payload += String(localBatteryPercent);
    payload += ",";

    // ================= PATIENT ATTENTION REQUEST =================
    payload += "\"patient_requests_attention\":";
    payload += attentionRequestPending ? "true" : "false";
    payload += ",";

    payload += "\"alert_message\":\"";
    payload += attentionRequestPending ? "Patient Requests Attention" : "";
    payload += "\",";

    // ================= IMU DATA =================
    payload += "\"imu_status\":\"";
    payload += (imuOk ? "VALID" : "INVALID");
    payload += "\",";
    payload += "\"acc_x_mps2\":";
    payload += String(ax_mps2, 3);
    payload += ",";

    payload += "\"acc_y_mps2\":";
    payload += String(ay_mps2, 3);
    payload += ",";

    payload += "\"acc_z_mps2\":";
    payload += String(az_mps2, 3);
    payload += ",";

    payload += "\"gyro_x_dps\":";
    payload += String(gx_dps, 3);
    payload += ",";

    payload += "\"gyro_y_dps\":";
    payload += String(gy_dps, 3);
    payload += ",";

    payload += "\"gyro_z_dps\":";
    payload += String(gz_dps, 3);
    payload += ",";

    // ================= BLE DATA =================
    payload += "\"ble_status\":\"SCANNING\",";
    payload += "\"ble_company_filter\":\"0x0505\",";
    payload += "\"ble_device_count\":";
    payload += String(countBLEDevices());
    payload += ",";

    payload += "\"ble_devices\":";
    payload += buildBLEJsonArray();

    payload += "}";

    bool ok = false;
    if (client.connected()) {
      ok = client.publish(TOPIC, payload.c_str());
    }
    lastMqttPublishOk = ok;
    if (ok && attentionRequestPending) {
      attentionRequestPending = false;
    }

    // Push the publish result immediately without waiting for the next UI tick.
    refresh_display_bridge();

    Serial.println("================================");
    Serial.print("Published topic: ");
    Serial.println(TOPIC);

    Serial.print("Publish result: ");
    Serial.println(ok ? "SUCCESS" : "FAILED");

    Serial.print("Payload length: ");
    Serial.println(payload.length());

    if (VERBOSE_MQTT_PAYLOAD_LOGS) {
      Serial.print("Published payload: ");
      Serial.println(payload);
    }

    if (!ok) {
      int state = client.state();
      Serial.print("MQTT publish failed, state=");
      Serial.print(state);
      Serial.print(" (");
      Serial.print(mqttStateName(state));
      Serial.println("). Will retry next cycle.");
      // Do NOT force-close the socket on a single failed publish — that fires
      // the LWT and causes reconnect flapping. loop()'s connected() guard
      // reconnects only if the connection is genuinely lost.
    }

    Serial.println("================================");
  }
}

// ==========================================================================
//  Below: display bring-up + Arduino entry points, from LVGL_Arduino.ino.
//  setup() builds the LVGL UI first, then hands off to Watch_Setup();
//  loop() keeps LVGL alive (Timer_Loop) and runs Watch_Loop().
// ==========================================================================

void force_lvgl_refresh(unsigned long duration_ms)
{
  unsigned long start = millis();
  while (millis() - start < duration_ms) {
    Timer_Loop();
    delay(5);
  }
}

void setup()
{
  Serial.begin(115200);
  delay(1000);

  Serial.println("Starting Waveshare LCD + LVGL...");

  LCD_Init();
  Set_Backlight(90);
  Lvgl_Init();

  // Create Patient Monitor UI
  Lvgl_Example1();

  // Force LVGL to draw the new screen before Watch_Setup() (sensor/WiFi bring-up).
  force_lvgl_refresh(1500);

  Serial.println("LVGL UI started.");
  Serial.println("Starting Watch system...");

  // Start GPS / MAX30102 / IMU / WiFi / MQTT / BLE logic
  Watch_Setup();

  Serial.println("Watch system started.");
}

void loop()
{
  // Keep LVGL alive
  Timer_Loop();

  // Sensors + MQTT publish cycle
  Watch_Loop();

  delay(5);
}
