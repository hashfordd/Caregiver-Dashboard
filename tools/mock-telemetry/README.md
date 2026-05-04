# mock-telemetry

CLI that publishes simulated `device/{patient_id}/telemetry` payloads against
a locally running Supabase stack. Phase 1 dependency for F4 — the dashboard's
live sensor cards consume what this generator emits.

## Modes

- **direct** _(default)_ — service-role insert into `sensor_readings`.
  Fastest dev loop. Bypasses the `mqtt_bridge` and exercises only the
  `realtime → dashboard` half of the chain.
- **bridge** — `POST` validated payloads to the `mqtt_bridge` HTTP
  endpoint. `supabase functions serve mqtt_bridge` must be running.
  Exercises the full `payload → bridge → DB → realtime → dashboard` path
  via the `processMessage` SSOT.

A future `mqtt` mode (publish to a Mosquitto broker that the long-running
bridge subscribes to) is the Phase 1 closure follow-up — see `BACKLOG.md`.

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
```

Stop with `Ctrl-C`.

## Flags

| Flag                 | Default                          | Notes                                                 |
| -------------------- | -------------------------------- | ----------------------------------------------------- |
| `--patient-id`       | _(required)_                     | UUID of the patient the dashboard is viewing.         |
| `--device-id`        | _(required)_                     | UUID for the simulated device row.                    |
| `--mode`             | `direct`                         | `direct` or `bridge`.                                 |
| `--interval`         | `1000`                           | Publish interval in ms.                               |
| `--url`              | `http://127.0.0.1:54321`         | Supabase API URL.                                     |
| `--bridge-url`       | `<url>/functions/v1/mqtt_bridge` | HTTP endpoint of the bridge.                          |
| `--service-key`      | `$SB_SERVICE_KEY`                | Service-role key. Never piped to the browser.         |
| `--no-ensure-device` | `false`                          | Skip the upsert into `devices`. Use if F10 paired it. |
