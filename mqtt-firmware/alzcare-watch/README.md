# alzcare-watch — combined wearable firmware

One Arduino sketch that runs **everything** on the ESP32-S3 watch:

- LVGL **Patient-Monitor UI** on the LCD
- **MAX30102** heart rate, **QMI8658** IMU, **NEO-6M** GPS, **BLE** beacon scan (company `0x0505`)
- **WiFi + TLS MQTT** broadcast to HiveMQ Cloud as one combined `.../total` packet
- **BOOT button** SOS / "patient requests attention"

`alzcare-watch.ino` is the merged program (display bring-up + sensors + WiFi/MQTT).
The `*.cpp` / `*.h` files are the Waveshare hardware/display **drivers**, unchanged —
Arduino compiles them into this same firmware. Open `alzcare-watch.ino` in the IDE
and the whole folder builds as one binary.

## Open it

File → Open → `mqtt-firmware/alzcare-watch/alzcare-watch.ino`
(the folder name and the `.ino` name match, as Arduino requires).

## Libraries (install via Library Manager)

| Library | Author | Version |
| --- | --- | --- |
| `lvgl` | LVGL | **8.4.0** (8.x — NOT 9.x) |
| `PubSubClient` | Nick O'Leary | latest |
| `TinyGPSPlus` | Mikal Hart | latest |
| `SparkFun MAX3010x Pulse and Proximity Sensor Library` | SparkFun | latest |
| `OneButton` | Matthias Hertel | latest |

`WiFi`, `WiFiClientSecure`, `Wire`, `BLEDevice` ship with the ESP32 core — no install.

## lv_conf.h (already handled)

LVGL needs a config file. A configured `lv_conf.h` (color depth 16, montserrat
12/14/18 enabled) is provided **in this folder** and a copy has been placed next
to the `lvgl` library folder
(`~/Documents/Arduino/libraries/lv_conf.h`) — which is where LVGL looks for it.
If you reinstall/upgrade LVGL, re-copy this folder's `lv_conf.h` there.

## Board + settings (Arduino IDE → Tools)

- **Board:** `ESP32S3 Dev Module`  ·  **Port:** `/dev/cu.usbmodem101`
- **USB CDC On Boot:** `Enabled`  ← required for the Serial monitor over native USB
- **PSRAM:** `OPI PSRAM`  (Waveshare ESP32-S3-Touch-LCD-1.47 = ESP32-S3R8)
- **Flash Size:** `16MB (128Mb)`
- **Partition Scheme:** `Huge APP (3MB No OTA/1MB SPIFFS)`  ← the BLE+LVGL+WiFi binary is big; the default partition overflows

> If the watch boot-loops or the display stays black after upload, the PSRAM
> mode is the usual culprit — switch `OPI PSRAM` ↔ `QSPI PSRAM`. The exact value
> for your module is on the Waveshare wiki for the board.

Then **Upload**. If it stalls at "Connecting…", hold **BOOT**, tap **RESET**, release BOOT.

## Network / pairing

- WiFi + broker credentials and this device's MAC live in `secrets.h`
  (gitignored). Copy `secrets.example.h` → `secrets.h` and fill in
  `SECRET_WIFI_SSID` / `SECRET_WIFI_PASS` for your network (ESP32 is
  **2.4 GHz only**), plus the HiveMQ host/user/pass and `SECRET_DEVICE_MAC`.
- It publishes to `alzcare/site1/patient001/total` and identifies itself by
  the `device_mac` from `SECRET_DEVICE_MAC`.
- **Pair that MAC** in the dashboard ("Set up hardware" → Pair) and run the ingest
  (`cd codebase && SB_SERVICE_KEY=… npm run stack:up`) so the shim/bridge route the
  data to a patient. An unpaired MAC is dropped.

> Broker credentials are read from `secrets.h` (gitignored), so real values
> never land in the committed sketch.

## BLE + WiFi + TLS coexistence

The watch runs WiFi, a TLS/MQTT connection, **and** the BLE beacon scanner on
one ESP32‑S3. All three share the limited internal SRAM, and the TLS handshake
in particular needs a large **contiguous** free block. If BLE is initialized
before MQTT connects, it fragments the heap and the TLS handshake fails — the
watch then publishes **nothing** (every publish is gated on `client.connected()`).

Two things make all three fit on the ESP32‑S3's limited internal SRAM:

1. **NimBLE instead of Bluedroid.** The firmware uses the **NimBLE** BLE stack
   (`#include <NimBLEDevice.h>`), which is ~50–100 KB lighter than the default
   Bluedroid stack — the standard fix for BLE + WiFi + TLS coexistence on ESP32.
   **You must install it:** Arduino IDE → *Tools → Manage Libraries* → search
   **"NimBLE-Arduino"** → install **version 1.4.x** (the code targets the 1.4.x
   API: `NimBLEAdvertisedDeviceCallbacks` / `onResult(NimBLEAdvertisedDevice*)`,
   and `getManufacturerData()` returns `std::string`; 2.x renamed these).
2. **LVGL draw buffers in PSRAM.** `LVGL_Driver.cpp` allocates the screen
   buffers from PSRAM (`heap_caps_malloc(..., MALLOC_CAP_SPIRAM)`), freeing the
   ~11 KB they used to take in internal SRAM. **Enable PSRAM:** Arduino IDE →
   *Tools → PSRAM → OPI PSRAM*. (If PSRAM is off, it falls back to internal RAM
   and the display still works, but BLE may be starved again.)

BLE is also brought up **lazily**: `Watch_Setup()` doesn't touch BLE;
`Watch_Loop()` calls `setup_ble()` ~3 s after the first successful MQTT connect,
once TLS already holds its contiguous block. `setup_ble()` then checks
`ESP.getMaxAllocHeap()` and **skips BLE if there still isn't room** (rather than
crash/reboot), so HR / IMU / GPS / battery / fall keep streaming regardless.

Watch the serial log:

- `[heap@ble] free=… largest=…` then `BLE scanner ready` → BLE is scanning;
  `ble_status` in the payload reads `SCANNING` and `ble_devices` fills in.
- `BLE: heap too low — skipping scanner` → still out of internal RAM. Confirm
  **PSRAM is enabled** (point 2 above); that's the usual cause.

## Source

Merged from the Waveshare `LVGL_Arduino` project tabs `LVGL_Arduino.ino` +
`Watch_Code_Broadcast_LVGL_Module.ino`; driver modules copied unchanged.
