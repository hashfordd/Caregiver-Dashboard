# protocol-shim

Translates the hardware prototype's MQTT dialect into the canonical
`device/{patient_uuid}/{telemetry,signals,events}` contract the `mqtt_bridge`
ingests. Runs as a standalone long-running process — no firmware or
edge-function changes required.

```
real device  ──▶ alzcare/{site}/patient{n}/total          (one combined packet)
prototype    ──▶ patient/{proto_id}/raw/{heartrate,imu,location}
                          │
                    [ protocol-shim ]   ← this tool (subscribes to both)
                          │
        device/{uuid}/{telemetry,signals,events}  (v:1, Zod-valid)
                          │
                  mqtt_bridge → DB / realtime → position_estimator
                          │
                  rules_engine + inactivity_scan → alerts → dashboard
```

## Mapping

| Prototype in (`patient/{id}/raw/…`) | Canonical out (`device/{uuid}/…`)  | Notes                                                                          |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| `heartrate.value`                   | `telemetry.hr_bpm`                 | telemetry emitted on each HR message                                           |
| `imu.{ax,ay,az}`                    | `telemetry.accel{x,y,z}`           | merged into the HR-triggered telemetry                                         |
| `imu.movement_rate > 2.0`           | `events {type:'fall'}`             | rising-edge latched (one event per fall)                                       |
| `location` BLE RSSI                 | `signals.ble[{mac,rssi}]`          | see TODO below                                                                 |
| `patient_id "001"`                  | patient + device **UUID**          | via `--map-file` or `--patient-id`/`--device-id`                               |
| —                                   | `v:1`, `recorded_at` (RFC3339 UTC) | injected; prototype timestamps are dropped (no timezone → fail `z.datetime()`) |

**Dropped on purpose:** D2-Processor's vitals/stationary thresholds — `rules_engine`
(vitals) and `inactivity_scan` (stationary) already own those server-side. Only
accel-based fall detection is ported here, because the fall rule fires on a
discrete `fall` event.

### Combined `alzcare/{site}/patient{n}/total` (the physical device)

The current device emits **one JSON packet per tick** instead of the per-kind
`raw/*` topics. `ingestTotal` (`lib/transform.ts`) fans it out into all three
canonical messages. The device's identity is its **`device_mac`** (in the
payload) — see [Pairing](#pairing-the-live-mechanism) below; the `alzcare/{site}/{id}/total`
topic is just a routing label.

| Combined in                        | Canonical out             | Notes                                                                                      |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| `avg_bpm` (else `bpm`)             | `telemetry.hr_bpm`        | only when `heart_rate_status == VALID` **and** `finger_status == DETECTED`                 |
| `acc_{x,y,z}_mps2`                 | `telemetry.accel{x,y,z}`  | **converted m/s² → g** (÷ 9.80665); same conversion feeds the fall latch                   |
| `gyro_{x,y,z}_dps`                 | `telemetry.gyro{x,y,z}`   | deg/s, forwarded as-is; gated on `imu_status == VALID`                                     |
| accel magnitude > 2.0 g            | `events {type:'fall'}`    | rising-edge latched — same threshold as the raw path                                       |
| `ble_devices[].{mac_address,rssi}` | `signals.ble[{mac,rssi}]` | **measured** RSSI passed straight through (no synthesis); bad/out-of-range entries dropped |
| `latitude`/`longitude`             | `signals.gps{lat,lng}`    | only when `gps_status == VALID` (the `0,0` "no fix" sentinel is dropped)                   |

> **Units matter:** this device reports acceleration in **m/s²** (≈ 9.8 at rest),
> whereas the fall latch is calibrated in **g** (baseline ≈ 1.0). `ingestTotal`
> divides by `G_MPS2` before the latch — without it every packet would read ~9.8
> and fire a fall instantly.
>
> The beacon MACs in `ble_devices` (e.g. `06:05:04:03:02:21`) must exist as
> `beacons` rows with `x_canvas/y_canvas` on the active floor plan, or
> `position_estimator` produces no map fix.

#### Pairing (the live mechanism)

The device includes **its own MAC** in the payload as `device_mac` (alias `mac`).
The shim resolves that MAC → the paired `{patient_id, device_id}` by querying the
`devices` table (`lib/pairing.ts`), so onboarding a device is just **Pair device →
enter MAC → pick patient** in the dashboard — no restart and no flags. A newly
paired device starts flowing within ~30 s (TTL cache); an unpaired MAC is skipped
with a once-a-minute warning. Requires a service key (`SB_SERVICE_KEY` / `--service-key`).

When the payload carries **no** `device_mac` (or no service key is available), the
shim falls back to the static proto-id mapping below — the pre-pairing behaviour,
handy for tests.

## Run

Prereqs: `npm run bridge:start` running, creds in `apps/edge/.env`
(`MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `SB_SERVICE_KEY`).
Run **`npm run seed:live`** once to create the fixed-UUID test patient
(`Live Feed Test`) with its device, floor plan, beacons, and alert rules.

```bash
# LIVE (real device): pairing is done in the dashboard — no per-patient flags.
# Reads MQTT_BROKER_URL / MQTT_USERNAME / MQTT_PASSWORD from the environment.
SB_SERVICE_KEY=… npm run shim:start
# (Normally started via `npm run stack:up` — see codebase/README + DEPLOY.md.)

# Override broker URL explicitly:
SB_SERVICE_KEY=… npm run shim:start -- \
  --mqtt-broker-url mqtts://<cluster>.s1.eu.hivemq.cloud:8883 --mqtt-username alzcare

# --- the rest are for TESTING without dashboard pairing (static mappings) ------

# Default: maps prototype id "001" → the seeded live-test patient. No flags needed
# when env vars are set.
npm run shim:start

# Override for a different / ad-hoc patient:
SB_SERVICE_KEY=… npm run shim:start -- \
  --proto-id 001 --patient-id <uuid> --device-id <uuid>

# Multiple patients via a JSON map file:
#   { "001": { "patient_id": "…", "device_id": "…" }, "002": { … } }
npm run shim:start -- --map-file ./map.json
```

The default mapping comes from `@alzcare/shared/fixtures`, so the shim and the
seed always agree on the UUIDs. `SB_SERVICE_KEY` is optional in the default
flow — the device already exists from `seed:live`, so the shim skips the
device-ensure when no key is given. Stop with `Ctrl-C`.

## Quick start — the whole stack in one command

```bash
cd codebase
npm run stack:up        # or double-click ../start-stack.command in Finder
```

`stack:up` starts the **bridge and shim** together against HiveMQ Cloud and
hosted Supabase in one terminal with prefixed output (Ctrl-C stops them).
Then drive a sensor:

```bash
npm run sim                          # baseline generator (HR/SpO2/temp + walk)
python3 "../../MQTT Setup/D1-Fall.py" # or any other scenario
```

The D1 generator now drives **both** vitals and the indoor walk (the shim
synthesises beacon RSSI from the walk against the software-placed beacons), so no
separate signals sim is needed.

## Manual (tab-per-service) flow

If you'd rather run each service in its own tab, all from `codebase/`
(creds in `apps/edge/.env`):

```bash
# 0. Seed (one-time)
SB_SERVICE_KEY=… npm run seed              # bootstraps admin + provider
SB_SERVICE_KEY=… npm run seed:live         # patient "Live Feed Test"
npm run bridge:start                       # canonical subscriber (own tab)

# 0b. Edge functions — REQUIRED for alerts + live positioning (own tab).
#     The --import-map flag is essential or the workers fail to boot.
npm run functions:serve
#     One-time Vault secrets so the alert/position webhooks can reach the
#     served functions (wiped by `supabase db reset` — re-run after a reset):
#       select vault.create_secret('http://host.docker.internal:54321/functions/v1','edge_functions_base_url');
#       select vault.create_secret('<local service_role key>','edge_functions_service_role_key');

# 1. Shim — no flags; reads broker creds from env (own tab)
npm run shim:start

# 2. Drive vitals + fall from the prototype (separate terminal / Interface.py)
python "../MQTT Setup/D1-Generator.py"     # baseline → sensor_readings fill
python "../MQTT Setup/D1-Fall.py"          # spike → fall event → critical alert

# 3. Positioning/map (canonical RSSI sim, same fixed patient)
SB_SERVICE_KEY=… MQTT_BRIDGE_PASSWORD=… npm run -w @alzcare/mock-telemetry start -- \
  --patient-id 11110000-1111-4111-8111-000000000001 \
  --device-id  22220000-2222-4222-8222-000000000001 \
  --mode mqtt --kind signals
```

Watch the dashboard "Live Feed Test" patient: HR tile tracks the generator, a
fall fires a critical alert, and the map dot moves with the signals sim (its MACs
match the seeded beacons). When real hardware arrives, its RSSI flows through
`ingestLocation` unchanged and replaces step 3.

Once live data is confirmed, drop the other demo patients:
`SB_SERVICE_KEY=… npm run seed:live -- --purge-demo`.

## Pairing real hardware (by MAC)

A real device only needs to know its own MAC. Pair it in the dashboard
("Pair device" → type the MAC), then have the device publish to
**`device/{mac}/{telemetry|signals|events}`** — the `mqtt_bridge` resolves the
MAC to its paired patient + device UUID and fills them in, so the payload
doesn't need any UUIDs. (An unpaired/unknown MAC is dropped until you pair it.)
The patient-keyed form `device/{patient_uuid}/…` still works for the shim and
sims. The dashboard's device row shows the resolved `device_id` + topic.

## Flags

| Flag                           | Default                  | Notes                                                                |
| ------------------------------ | ------------------------ | -------------------------------------------------------------------- |
| `--proto-id`                   | `001`                    | Prototype patient id in the single-patient form.                     |
| `--patient-id` / `--device-id` | —                        | Real UUIDs for the single-patient form.                              |
| `--map-file`                   | —                        | JSON `{ protoId: { patient_id, device_id } }` for multiple patients. |
| `--mqtt-broker-url`            | `$MQTT_BROKER_URL`       | HiveMQ Cloud URL (`mqtts://<cluster>.s1.eu.hivemq.cloud:8883`).      |
| `--mqtt-username`              | `$MQTT_USERNAME`         | HiveMQ credential; reads prototype topics and publishes canonical.   |
| `--mqtt-password`              | `$MQTT_BRIDGE_PASSWORD`  | Broker password.                                                     |
| `--url`                        | `http://127.0.0.1:54321` | Supabase URL (ensure-device only).                                   |
| `--service-key`                | `$SB_SERVICE_KEY`        | Service-role key for the device upsert.                              |
| `--no-ensure-device`           | `false`                  | Skip the `devices` upsert (use if already paired).                   |
| `--allow-non-local`            | `false`                  | Required to ensure-device against a non-local Supabase.              |

## Open items (finish before the live demo)

1. **`raw/location` payload (`ingestLocation` in `lib/transform.ts`).** The
   hardware reports BLE RSSI; this passes a `ble: [{ mac, rssi }]` array straight
   through. Confirm the real on-the-wire shape and the beacon MACs, then adjust
   the mapping. The prototype's _simulator_ emits absolute `{x,y}` (skipped with a
   warning) — that path can't feed RSSI positioning, which is why the sim phase
   drives the map via `mock-telemetry`/`replay-signals` instead.
2. **Beacon registration (real hardware).** For the sim patient this is handled
   by `seed:live`. When real sensors arrive, the MACs they report must exist as
   `beacons` rows with `x_canvas/y_canvas` on the active floor plan, or
   `position_estimator` produces no estimate.
3. **Telemetry cadence.** Currently HR-triggered (≈ the prototype's 2 s tick).
   Switch to a fixed timer if `sensor_readings` row rate needs decoupling from HR.
