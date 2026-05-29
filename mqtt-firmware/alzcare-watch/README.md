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

- WiFi + MQTT credentials and the device MAC live in **`secrets.h`** (gitignored;
  copy `secrets.example.h` → `secrets.h` and fill in). ESP32 is **2.4 GHz only**.
- It publishes to `alzcare/site1/patient001/total` and identifies itself by the
  `SECRET_DEVICE_MAC` in `secrets.h`.
- **Pair that MAC** in the dashboard ("Set up hardware" → Pair) and run the ingest
  (`cd codebase && SB_SERVICE_KEY=… npm run stack:up`) so the shim/bridge route the
  data to a patient. An unpaired MAC is dropped.

> Broker credentials are embedded in the sketch (as in the original firmware).
> Keep this folder private if that matters for your repo.

## Source

Merged from the Waveshare `LVGL_Arduino` project tabs `LVGL_Arduino.ino` +
`Watch_Code_Broadcast_LVGL_Module.ino`; driver modules copied unchanged.
