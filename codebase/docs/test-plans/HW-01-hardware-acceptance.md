# HW-01 — Real-hardware acceptance run

The end-to-end path is verified in CI (426 unit tests) and live against the hosted
stack via the simulator. This runbook is the final acceptance step that the simulator
can't cover: a real ESP32 wearable + BLE beacons driving the live pipeline. It is
designed to be one sitting, ~15 min, with copy-paste verification queries.

## What this proves

`firmware → HiveMQ Cloud → protocol-shim → mqtt_bridge → hosted Supabase → dashboard`,
for every hardware data type the device emits (see [[project-firmware-contract]] /
`docs` firmware notes): heart rate, IMU (incl. software fall detection), BLE RSSI
triangulation, and GPS.

## Prerequisites

- [ ] ESP32 watch flashed with `LVGL_Arduino/Watch_Code_Broadcast_LVGL_Module.ino`,
      powered, and joined to Wi-Fi. Serial monitor shows `Published topic:
    alzcare/site1/patient001/total` with `Publish result: SUCCESS`.
- [ ] At least 3 BLE beacons powered and physically placed in the test space.
- [ ] The device MAC is paired to the demo patient (`devices.paired_patient_id`), and
      that patient has a saved, **scaled** floor plan with the 3–4 beacons **placed**
      (`beacons.x_canvas/y_canvas` set) at positions matching the real layout.
- [ ] `apps/edge/.env` filled (HiveMQ + hosted Supabase service role).
- [ ] Ingest server running: `npm run stack:up` (watch for `shim: device … paired`,
      `4 placed beacons loaded`, bridge `subscribed device/+/+`).

## Procedure + checks

Replace `<patient-uuid>` with the demo patient id in each query.

### 1. Heart rate → sensor_readings → vitals alert

- [ ] Wear the device; confirm the watch shows a finger-detected HR.
- [ ] Query — a fresh HR reading lands:
  ```sql
  select count(*), max(recorded_at), max(hr_bpm)
  from sensor_readings
  where patient_id = '<patient-uuid>' and recorded_at > now() - interval '2 minutes';
  ```
  Expect `count > 0`, `recorded_at` within seconds, plausible `hr_bpm`.
- [ ] Drive HR outside the vitals range (exertion, or temporarily narrow the HR rule).
      Confirm a `vitals` alert fires:
  ```sql
  select severity, context->>'metric', context->>'value', fired_at
  from alerts where patient_id = '<patient-uuid>'
    and fired_at > now() - interval '5 minutes' order by fired_at desc;
  ```

### 2. IMU fall → events → critical alert

- [ ] Simulate a fall (sharp movement spike then rest — do NOT drop the device; shake
      hard past the latch threshold). Confirm exactly one fall event + one critical alert:
  ```sql
  select 'event' k, type, occurred_at::text, payload::text from events
    where patient_id='<patient-uuid>' and occurred_at > now() - interval '3 minutes'
  union all
  select 'alert', severity::text, fired_at::text, context->>'event_id' from alerts
    where patient_id='<patient-uuid>' and fired_at > now() - interval '3 minutes' and severity='critical';
  ```
  Expect **1** fall event and **1** critical alert referencing it (the bridge dedup
  fix guarantees one-alert-per-event even on MQTT redelivery).

### 3. BLE RSSI → position_estimates (indoor triangulation)

- [ ] Stand at a known spot inside the beacon footprint for ~10 s, then move to another.
      Confirm position estimates land and track:
  ```sql
  select count(*), max(recorded_at), string_agg(distinct mode::text, ',')
  from position_estimates
  where patient_id='<patient-uuid>' and recorded_at > now() - interval '2 minutes';
  ```
  Expect `count > 0`, `mode = 'indoor'`. Open the dashboard **Live** tab and confirm
  the marker sits near your real position and moves as you walk. (Unlike the simulator,
  real measured RSSI varies per beacon, so trilateration is well-conditioned.)

### 4. GPS → outdoor mode

- [ ] Take the device outside (or where GPS gets a fix). Confirm the Live view switches
      to the outdoor map with the latest fix:
  ```sql
  select mode, lat, lng, recorded_at from position_estimates
  where patient_id='<patient-uuid>' and recorded_at > now() - interval '2 minutes'
  order by recorded_at desc limit 5;
  ```
  Expect rows with `mode = 'outdoor'` and a real lat/lng once GPS is valid.

## Pass criteria

All four checks produce the expected rows AND the dashboard reflects them live within
~2 s. Record below.

| Run | Date | Tester | HR  | Fall | Indoor | GPS | Outcome   |
| --- | ---- | ------ | --- | ---- | ------ | --- | --------- |
| 1   |      |        |     |      |        |     | Pass/Fail |

## Cleanup

Test rows are in the hosted dev DB and can be removed by date if they clutter the demo:

```sql
delete from alerts where fired_at::date = '<yyyy-mm-dd>';
delete from events where occurred_at::date = '<yyyy-mm-dd>';
-- sensor_readings / position_estimates similarly, scoped by recorded_at::date.
```

See also: [demo script](../demo/script.md), [TST-10 continuous run](./TST-10-continuous-run.md).
