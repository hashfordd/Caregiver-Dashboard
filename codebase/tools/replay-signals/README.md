# replay-signals

F8 verification harness. Replays synthetic `SignalsMessage` fixtures
through the `mqtt_bridge` HTTP entry, then queries `position_estimates`
and reports indoor-positioning accuracy against ground truth.

Two subcommands:

## 1. Generate a fixture

Synthesises a straight-line walk through a room with three placed
beacons. Reverse-applies the path-loss model on each tick + Gaussian
RSSI noise (1.5 dB by default) so the fixture matches what F8's
pipeline expects to see in production.

```bash
SB_SERVICE_KEY=$(supabase status -o env | awk -F'=' '/SERVICE_ROLE_KEY/{print $2}' | tr -d '"')

npm run -w @alzcare/replay-signals start -- generate ./fixtures \
  --patient-id bda1874e-e17b-4dc4-a79f-bf6c94127120 \
  --device-id  c0fee000-c0fe-c0fe-c0fe-c0fec0fec0fe \
  --beacon 'AA:BB:CC:DD:EE:01|60,120' \
  --beacon 'AA:BB:CC:DD:EE:02|340,120' \
  --beacon 'AA:BB:CC:DD:EE:03|200,340' \
  --start-x 80 --start-y 130 --end-x 320 --end-y 220 \
  --noise-db 1.5 --seed 2026 --ticks 60
```

Writes `fixtures/walk-1.jsonl` (the `SignalsMessage` payloads, one per
line) and `fixtures/walk-1-truth.jsonl` (the ground-truth
`(x_canvas, y_canvas)` per tick). Identical seed → identical fixture, so
accuracy numbers are reproducible.

## 2. Run the replay

Posts each fixture line to the bridge at the recorded 1 Hz cadence,
waits for `position_estimator` to drain, then queries
`position_estimates` (rows created after the run started) and joins
them against truth by `recorded_at`. Reports mean / p50 / p80 / p95 /
max error in metres and exits 0 if F8's accuracy gate
(< 1.5 m on 80 % of samples) is met.

Prerequisites:

- The patient already has 3 placed beacons whose `mac_address` matches
  the fixture's `--beacon` ids.
- The patient's most recent `floor_plans` row has `scale_meters_per_pixel`
  populated.
- (Recommended) ≥ 8 calibration points captured across the room
  (Phase 2 exit gate).
- Supabase running locally; `mqtt_bridge` and `position_estimator`
  served via `supabase functions serve mqtt_bridge` and `supabase
functions serve position_estimator` (or hosted equivalents).

```bash
npm run -w @alzcare/replay-signals start -- run ./fixtures/walk-1.jsonl \
  --truth ./fixtures/walk-1-truth.jsonl \
  --bridge-url http://127.0.0.1:54321/functions/v1/mqtt_bridge \
  --url http://127.0.0.1:54321 \
  --service-key "$SB_SERVICE_KEY" \
  --patient-id bda1874e-e17b-4dc4-a79f-bf6c94127120
```

Sample output:

```
replay-signals: read 60 ticks from ./fixtures/walk-1.jsonl
replay-signals: posted 60/60 ticks; draining...
replay-signals: 60 position_estimates rows landed

=== F8 accuracy report ===
  fixture:           ./fixtures/walk-1.jsonl
  truth-joined:      60 ticks
  scale_m_per_px:    0.014
  mean error:        0.62 m
  p50:               0.55 m
  p80:               0.91 m
  p95:               1.34 m
  max:               1.81 m
  under 1.5 m:       95.0 %
  target:            < 1.5 m on 80 % of samples
  result:            PASS ✓
```

## Flags

### `generate`

| Flag           | Default           | Notes                                                       |
| -------------- | ----------------- | ----------------------------------------------------------- |
| `--patient-id` | _(required)_      | UUID of the patient the fixture targets.                    |
| `--device-id`  | _(required)_      | UUID for the simulated device.                              |
| `--beacon`     | _(required, ≥ 3)_ | `'<mac>\|<x>,<y>[,<rssi1m>]'` per beacon. Repeat ≥ 3 times. |
| `--start-x/y`  | `60` / `120`      | Walk start point (canvas px).                               |
| `--end-x/y`    | `300` / `120`     | Walk end point (canvas px).                                 |
| `--noise-db`   | `1.5`             | Per-sample Gaussian RSSI noise (σ).                         |
| `--seed`       | `2026`            | LCG seed for reproducibility.                               |
| `--ticks`      | `60`              | Number of fixture ticks (1 Hz).                             |

### `run`

| Flag                  | Default                                           | Notes                                                            |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `--truth`             | _(optional)_                                      | If supplied, accuracy report is computed.                        |
| `--bridge-url`        | `http://127.0.0.1:54321/functions/v1/mqtt_bridge` | Bridge HTTP entry.                                               |
| `--url`               | `http://127.0.0.1:54321`                          | Supabase API URL (for `position_estimates` query).               |
| `--service-key`       | `$SB_SERVICE_KEY`                                 | Service-role key.                                                |
| `--patient-id`        | _(required)_                                      | Filter for `position_estimates` and the floor plan scale lookup. |
| `--target-error-m`    | `1.5`                                             | F8 accuracy budget.                                              |
| `--target-percentile` | `0.8`                                             | F8 accuracy percentile.                                          |
| `--drain-ms`          | `2000`                                            | Wait between last post and the query.                            |

## V2 follow-ups

- **Real-environment fixture** — synthesised fixtures catch algorithm
  regressions but not model-vs-physics gaps (multipath, NLOS, body
  shadowing). Replace `walk-1.jsonl` with a captured walkthrough before
  EV-05. (BACKLOG)
- **Dropout / NLOS / mode-flap fixtures** — pipeline.test.ts already
  covers these at the unit level; the harness should grow per-scenario
  fixtures once the V2 real-environment baseline lands.
