# protocol-shim

Translates the hardware prototype's MQTT dialect into the canonical
`device/{patient_uuid}/{telemetry,signals,events}` contract the `mqtt_bridge`
ingests. Runs as a standalone long-running process — no firmware or
edge-function changes required.

```
real sensors ──▶ patient/{proto_id}/raw/{heartrate,imu,location}
                          │
                    [ protocol-shim ]   ← this tool
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

## Run

Prereqs (same machine): `npm run broker:up`, `npm run bridge:start`,
`npm run supabase:start`, then **`npm run seed:live`** — which creates the
fixed-UUID test patient (`Live Feed Test`) with its device, floor plan, beacons,
and alert rules, allocated to the admin so it shows in the dashboard.

```bash
# Default: maps prototype id "001" → the seeded live-test patient. No flags.
MQTT_BRIDGE_PASSWORD="<backend-bridge-pw>" npm run shim:start

# Override for a different / ad-hoc patient:
SB_SERVICE_KEY=… MQTT_BRIDGE_PASSWORD=… npm run shim:start -- \
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

`stack:up` is idempotent and does everything: starts Docker → broker → Supabase
→ seeds the admin + "Live Feed Test" patient → sets the Vault secrets → then runs
the **bridge, edge functions, shim, and dashboard** together in one terminal with
prefixed output (Ctrl-C stops them all). `npm run stack:down` stops the broker +
Supabase. Then drive a sensor:

```bash
npm run sim                          # baseline generator (HR/SpO2/temp + walk)
python3 "../../MQTT Setup/D1-Fall.py" # or any other scenario
```

The D1 generator now drives **both** vitals and the indoor walk (the shim
synthesises beacon RSSI from the walk against the software-placed beacons), so no
separate signals sim is needed.

## Manual (tab-per-service) flow

If you'd rather run each service in its own tab, all from `codebase/` (Docker
must be running first):

```bash
# 0. Stack up + fixed-UUID test patient (beacons, rules, device — all seeded)
npm run broker:up && npm run supabase:start
SB_SERVICE_KEY=… npm run seed              # bootstraps admin + provider (once)
SB_SERVICE_KEY=… npm run seed:live         # patient "Live Feed Test"
npm run bridge:start                       # canonical subscriber (own tab)

# 0b. Edge functions — REQUIRED for alerts + live positioning (own tab).
#     The --import-map flag is essential or the workers fail to boot.
npm run functions:serve
#     One-time Vault secrets so the alert/position webhooks can reach the
#     served functions (wiped by `supabase db reset` — re-run after a reset):
#       select vault.create_secret('http://host.docker.internal:54321/functions/v1','edge_functions_base_url');
#       select vault.create_secret('<local service_role key>','edge_functions_service_role_key');

# 1. Shim — no flags, defaults to the live-test patient (own tab)
MQTT_BRIDGE_PASSWORD=… npm run shim:start

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
| `--mqtt-broker-url`            | `mqtt://127.0.0.1:1883`  | Loopback for same-machine sensors.                                   |
| `--mqtt-username`              | `backend-bridge`         | Has `readwrite #` in the ACL (reads raw, writes canonical).          |
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
