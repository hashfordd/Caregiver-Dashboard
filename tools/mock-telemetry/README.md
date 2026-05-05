# mock-telemetry

CLI that publishes simulated `device/{patient_id}/<kind>` payloads against
a locally running Supabase stack. Phase 1 dependency for F4 (telemetry)
and Phase 2 dependency for F6 (signals discovery / pairing).

## Modes (transport)

- **direct** _(default)_ — service-role insert into `sensor_readings`.
  Fastest dev loop. Bypasses the `mqtt_bridge` and exercises only the
  `realtime → dashboard` half of the chain. Telemetry only.
- **bridge** — `POST` validated payloads to the `mqtt_bridge` HTTP
  endpoint. `supabase functions serve mqtt_bridge` must be running.
  Exercises the full `payload → bridge → DB | broadcast → realtime →
dashboard` path via the `processMessage` SSOT.
- **mqtt** — Publish via the broker. `npm run broker:up` plus
  `npm run bridge:start` for the long-running subscriber. Exercises the
  full Phase 1/2 spine: firmware → broker → bridge → DB | broadcast →
  realtime → dashboard.

## Kinds (message shape)

- **telemetry** _(default)_ — `TelemetryMessage` with `hr_bpm`, `spo2_pct`,
  `temp_c`. Persisted into `sensor_readings`.
- **signals** — F6: `SignalsMessage` with three stable mock BLE MACs at
  jittering RSSI in `[-90, -50] dBm`. Bridge re-broadcasts on
  `patient:<id>:signals`. **Not persisted by design** — direct mode is
  unavailable for `--kind signals`.

## Usage

```bash
# Get the local Supabase URLs / keys
supabase status

# Default direct mode, 1 Hz, ensures the device row exists
SB_SERVICE_KEY="<service-role-key>" \
  npm run -w @alzcare/mock-telemetry start -- \
  --patient-id 11111111-1111-1111-1111-111111111111 \
  --device-id  22222222-2222-2222-2222-222222222222

# Bridge mode (requires `supabase functions serve mqtt_bridge`)
SB_SERVICE_KEY="<service-role-key>" \
  npm run -w @alzcare/mock-telemetry start -- \
  --patient-id 11111111-1111-1111-1111-111111111111 \
  --device-id  22222222-2222-2222-2222-222222222222 \
  --mode bridge --interval 500

# F6 signals: bridge re-broadcasts on patient:<id>:signals
SB_SERVICE_KEY="<service-role-key>" \
  npm run -w @alzcare/mock-telemetry start -- \
  --patient-id 11111111-1111-1111-1111-111111111111 \
  --device-id  22222222-2222-2222-2222-222222222222 \
  --mode bridge --kind signals --interval 1000
```

Stop with `Ctrl-C`.

## Flags

| Flag                 | Default                          | Notes                                                 |
| -------------------- | -------------------------------- | ----------------------------------------------------- |
| `--patient-id`       | _(required)_                     | UUID of the patient the dashboard is viewing.         |
| `--device-id`        | _(required)_                     | UUID for the simulated device row.                    |
| `--mode`             | `direct`                         | `direct`, `bridge`, or `mqtt`.                        |
| `--kind`             | `telemetry`                      | `telemetry` (default) or `signals` (F6).              |
| `--interval`         | `1000`                           | Publish interval in ms.                               |
| `--url`              | `http://127.0.0.1:54321`         | Supabase API URL.                                     |
| `--bridge-url`       | `<url>/functions/v1/mqtt_bridge` | HTTP endpoint of the bridge.                          |
| `--service-key`      | `$SB_SERVICE_KEY`                | Service-role key. Never piped to the browser.         |
| `--no-ensure-device` | `false`                          | Skip the upsert into `devices`. Use if F10 paired it. |
