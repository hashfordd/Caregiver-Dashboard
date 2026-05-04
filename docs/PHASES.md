# Phases

The build moves through five phases after foundation. Each phase delivers a coherent, demo-able vertical and explicitly unblocks the next.

The phase boundaries are deliberate — they're the points where we stop, integration-test the slice that just shipped, and only then move on. Phase exit criteria are integration-level (behaviour observable at the system boundary), not workstream-level.

| Phase | Theme      | Features                        | Verification gate                                                                        |
| ----- | ---------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 0     | Foundation | (scaffold)                      | ✅ Done                                                                                  |
| 1     | Spine      | F1, F2, F3, F4, F10             | ✅ Done                                                                                  |
| 2     | Place      | F5, F6, F7                      | Caregiver draws a 4-room space, places ≥3 beacons, captures ≥8 calibration points        |
| 3     | Locate     | F8, F9                          | Live indoor marker < 1.5 m error on 80% samples; outdoor map switches with hysteresis    |
| 4     | Alert      | F11, F12                        | 5 rule types configurable, alerts surface in bell within 2 s, ack persists across reload |
| 5     | Polish     | F13 + accessibility + demo prep | Replay 1 h at 10×, CSV export, WCAG AA on critical paths, two demo dry-runs              |

Reading order for each phase below: **goal → entry → critical path → exit → integration tests → risks**.

---

## Phase 0 — Foundation (✅ done)

What shipped: monorepo skeleton, Supabase migration with 12 tables / RLS read-scoping / realtime publication / signup trigger, MQTT broker config (TLS + ACL pattern), three edge function stubs (Deno), web scaffold with auth + protected routing + `usePatientStream` hook, CI/CD, brand theme tokens, docs.

What's deliberately deferred until consumed: front-end libs not yet needed (Fabric, Mapbox, Recharts), seed demo data, RLS write policies, audit log triggers, deployed Supabase project. See [BACKLOG.md](../BACKLOG.md).

The next thing to land is the **mock telemetry generator** — a small TS script that publishes simulated telemetry/signals/events to the broker so frontend and edge work can develop without firmware. This is genuinely on the critical path for Phase 1 and is missing from the comprehensive task list; it lives at `tools/mock-telemetry/` and is owned by the BE workstream. Document it as a Phase 1 entry requirement.

---

## Phase 1 — Spine (✅ done)

What shipped: F1 (signup/profile, RLS write surface), F2 (roster, create-with-allocation RPC), F3 (detail shell, single-mount realtime context, tabs), F4 (live sensor cards, Zustand store, sparkline, processMessage SSOT, mock-telemetry generator), F10 (pair_device RPC, write policies, label column, pairing panel, heartbeat).

Phase 1 closure additions: long-running Deno bridge (`apps/edge/functions/mqtt_bridge/longRunning.ts`) subscribed to `device/+/+`; Mosquitto auth (`backend-bridge` account + ACL pattern; one-time `npm run broker:creds`); mqtt mode on the mock generator (`--mode mqtt` publishes via mqtt.js to the broker). Verified end-to-end: 9 telemetry messages over 6 s travelled mock → broker → bridge → DB; `devices.last_seen_at` advanced.

What's deferred from Phase 1: bridge Dockerfile + docker-compose service entry (production hardening — bridge runs as `npm run bridge:start` for now); structured latency instrumentation (dev console only). See [BACKLOG.md](../BACKLOG.md).

The original Phase 1 plan, retained below for reference.

---

**Goal**: A logged-in caregiver sees one allocated patient, clicks into the patient detail dashboard, and watches HR / SpO2 / temperature update in real time from a paired device. This is the smallest closed loop that proves the architecture works end-to-end.

**Entry criteria**

- Phase 0 verification gate passed (already true).
- Mock telemetry generator at `tools/mock-telemetry/` (described below) is operational — can publish well-formed `device/{patient_id}/telemetry` messages on a configurable interval.
- Supabase running locally (`supabase start`); MQTT broker running locally (`npm run broker:up`).
- A real caregiver account seeded (the `admin@bizzieapp.com` test user we created during foundation verify, or one created via the F1 signup flow).

**Critical path**

The five Phase 1 features have a partial dependency order. F1 must close before any UI gates open; F10 must exist before sensor data has a `device_id` to anchor on; F2 → F3 is a navigation chain; F4 sits in F3.

```
F1 (auth closure)
 ├── F2 (roster) ──── F3 (dashboard shell) ──── F4 (live sensors)
 └── F10 (device pairing) ─────────────────────────┘
```

The right sequencing is: **F1 → (F2, F10 in parallel) → F3 → F4**. F2 and F10 are independent enough to parallelise once F1 closes. F3 needs F2 (you click into a patient from the roster). F4 needs F3 (the cards live inside the patient detail tab structure) and benefits from F10 (so a real `device_id` exists), but can develop against the mock telemetry generator before F10 is wired through.

**Mqtt_bridge promotion** (BE-06): the foundation stub validates payloads but doesn't persist. Phase 1 must turn it into a real persistence path. Two architectural options:

1. **HTTP-mode bridge** — leave it as a Supabase Edge Function, have the mock generator and (later) firmware POST to its URL. Cheap to deploy, but firmware shouldn't speak HTTP — it speaks MQTT. The "real" deployment requires a separate component that subscribes to the broker and forwards to the function. Doubles the surface area.
2. **Long-running Deno container** — deploy the bridge to Fly.io / EC2 as a persistent process that subscribes to MQTT and writes directly to Postgres via `@supabase/supabase-js` with the service role key. This is what the spec implies and what production will need.

**Recommendation**: build the bridge logic as a single Deno module that exports a `processMessage(topic, payload)` function. Wrap it in two entry points: an HTTP handler (for ad-hoc testing and CI) and a long-running MQTT subscriber (for development and production). Both live in `apps/edge/functions/mqtt_bridge/`. The dev experience uses the long-running mode driven by docker-compose; CI uses the HTTP handler against a seeded Supabase. This keeps the validation/persistence logic single-sourced.

This decision belongs in [CROSS_CUTTING.md §11 — Edge function runtimes](./CROSS_CUTTING.md#11-edge-function-runtimes-deno-vs-long-running). It's a Phase 1 deliverable to make this concrete.

**The service-role question**: the bridge writes to `sensor_readings`, `position_estimates`, etc. as the system, not as a caregiver. It must use the service role key and bypass RLS. Document this in [CROSS_CUTTING.md §1 — RLS write policies](./CROSS_CUTTING.md#1-rls-write-policies). The implication for Phase 1 is that the `mqtt_bridge` config needs `SUPABASE_SERVICE_ROLE_KEY` in its env, and care must be taken to never accept that key from any client.

**Exit criteria**

- A new caregiver signs up via `/signup` with role selection and lands on the protected `/` route.
- The caregiver creates a patient and is auto-allocated to it (allocations row).
- The caregiver pairs a device to that patient (F10).
- The mock generator publishes telemetry for that `patient_id` at 1 Hz.
- The dashboard shows live HR / SpO2 / temperature cards updating within 1 s of arrival; sparklines show the last 5 minutes.
- A connection-status indicator turns red within 30 s of the generator stopping (stale-data detection from F4).
- TST-01, TST-02, TST-03 from the task list pass: sensor → broker, broker → Postgres, Postgres → dashboard realtime.

**Integration tests** (the verification gate to Phase 2)

1. **Full chain latency** (TST-04 partial). Inject a timestamped telemetry message from the mock generator. Measure ms from publish to render. Target: median < 1 s; p99 < 3 s.
2. **Realtime resilience under network drop**. Disable broker mid-test → confirm `usePatientStream` shows `CHANNEL_ERROR` status; re-enable → confirm subscription resumes without page reload.
3. **RLS enforcement**. Attempt to read patient B's `sensor_readings` from caregiver A's session via the JS client. Assert empty result. Add this as a Vitest in `apps/web/src/test/`.
4. **Auth-trigger correctness**. Re-run the foundation verify (signup creates `caregivers` row with role from metadata; cascade delete works). Same fixture as in [foundation verify](../README.md#first-time-setup), ideally CI-runnable against a seeded local Supabase.

**Risks**

- **No firmware to test against**. Mitigation: the mock generator. Its schema must be the same Zod schema the bridge validates against — they share `@alzcare/shared/mqtt`. If the firmware ships and produces a different shape, the schema fails closed (validation rejects), surfacing the issue immediately.
- **MQTT bridge runtime model isn't proven**. Mitigation: build the long-running mode in dev with docker-compose; smoke-test on Fly.io before Phase 4 (when production-shaped traffic matters most for alerts).
- **Service-role key handling**. Mitigation: NEVER ship the service-role key to the browser. The bridge runs on a server we control. Add a CI grep rule: fail if `SUPABASE_SERVICE_ROLE_KEY` appears in `apps/web/`.
- **Allocation UX**. The simplest prototype path is "creating a patient auto-allocates the creator". Family caregivers without create permission need an invite path — defer that to F2 specifics or Phase 2.

---

## Phase 2 — Place

**Goal**: A caregiver draws their patient's space to scale, places BLE beacons at their real-world locations on the canvas, and walks the calibration points to fingerprint the space.

**Entry criteria**

- Phase 1 done — signed-in caregiver can see a patient detail dashboard.
- Real or mock device publishes signals (BLE+WiFi RSSI) on `device/{patient_id}/signals`. The mock generator from Phase 1 needs to grow a signals mode for Phase 2 development. This is not new infra — it's a new code path in the same generator using the existing `SignalsMessage` Zod schema. Add to `tools/mock-telemetry/`.

**Critical path**

```
F5 (floor plan editor) ──┬── F6 (beacon pairing & placement)
                          └── F7 (calibration workflow)
```

F6 needs F5 (you can't place beacons without a canvas). F7 needs F5 + F6 (calibration captures fingerprints at known canvas coordinates with known beacons in the field).

**Fabric.js choice locked**. The spec endorses it; Konva is the alternative if perf becomes an issue. For prototype scope (one patient, ≤6 rooms, ≤10 beacons, ≤20 furniture items), Fabric.js handles it comfortably. Lock the version when F5 starts; pin in `apps/web/package.json`.

**Canvas state design** is the load-bearing decision in Phase 2. The `floor_plans.canvas_json` column stores the Fabric.js `toJSON()` output. Decisions:

- Canvas units are **pixels**; real-world scale is encoded by `floor_plans.scale_meters_per_pixel` (a number, derived from a measurement input by the caregiver — they tell us "this wall is 3 metres" and we compute the ratio from the drawn line's pixel length).
- Beacons are **separate rows in `beacons`**, not embedded in `canvas_json`. Their canvas coordinates `(x_canvas, y_canvas)` index into the same coordinate system but live in their own table because they're addressable, FK'd to `floor_plan_id`, and updated independently.
- Calibration points are likewise **separate rows in `calibration_points`** — the canvas just renders them as visual annotations.
- Furniture items live **inside `canvas_json`** — they're decorative, not addressable; saving the whole canvas serialises them automatically.

This split (addressable entities → tables; decorative geometry → JSONB) is the principle. Capture it in [CROSS_CUTTING.md §6 — Canvas state](./CROSS_CUTTING.md#6-canvas-state-pattern).

**Calibration design**: a guided walk where the caregiver clicks suggested points on the canvas and presses "capture" while standing the wearable at that physical spot. The capture endpoint must:

1. Open a 5–10 s window of subscribing to the latest signals from this patient's device.
2. Aggregate the BLE/WiFi RSSI samples (mean per beacon/AP, with sample count and stddev).
3. Insert one `calibration_points` row with `ble_signature` + `wifi_signature` as JSONB.

This is a stateful task that doesn't fit the request-scoped Edge Function model neatly. Two options:

- **Client-driven aggregation**: the dashboard subscribes via `usePatientStream`, accumulates samples for the window, and POSTs the aggregated signature to a write endpoint. Simple. Works.
- **Edge function with a polling loop**: the function reads N seconds of `sensor_readings`-equivalent rows (we'd need a `signals` table) and aggregates server-side.

The first option is simpler and proportional to prototype scope. It also means we don't need a `signals` table at rest — the bridge writes them to a fast TTL store or just discards them after position estimation, since the actual stored artefacts are `position_estimates` (the computed result). Aggregation happens at calibration time and at runtime in `position_estimator`. **Recommendation**: Phase 2 uses client-driven aggregation; revisit when F8 ships if the position estimator needs persisted signals.

**Exit criteria**

- A caregiver draws a 4-room floor plan with 6 furniture items, saves it, refreshes, sees it intact (F5 acceptance).
- Three beacons can be paired, placed on the canvas, and persisted (F6 acceptance).
- Eight calibration points captured across the test space, each row in `calibration_points` showing populated `ble_signature` and `wifi_signature` (the F7 spec criterion about positioning accuracy belongs to Phase 3 — see Risks).

**Integration tests**

1. **Round-trip canvas state**. Save a canvas with mixed walls / rooms / furniture / scale → reload → assert pixel-perfect render (visual diff or canvas object count).
2. **Beacon discovery**. With the mock generator publishing signals containing 3 known BLE MACs, the F6 discovery view should show all 3 within one capture window. Vitest with a mocked `usePatientStream`.
3. **Calibration aggregation correctness**. Drive the mock generator to publish a known RSSI distribution for 8 seconds, run capture, assert the resulting `ble_signature` mean is within 2 dB of expected per beacon.

**Risks**

- **Spec acceptance leak**. F7's stated acceptance — "position estimate error < 1.5 m on 80% of test samples" — actually requires F8 to compute the estimate. Treat that criterion as belonging to Phase 3, not Phase 2. Phase 2's F7 acceptance is **calibration data captured with sufficient quality** (sample count, signal stability), measured by sample-window stddev thresholds.
- **Canvas units drift**. If the caregiver re-draws and moves beacons after a calibration, the `(x_canvas, y_canvas)` of the calibration points becomes stale. Decision: changing the floor plan invalidates calibrations attached to it. UX must surface this; possibly cascade-delete calibration_points when the underlying floor plan's `canvas_json` shape changes meaningfully (or ask the caregiver). For prototype: warn on canvas save if calibrations exist; don't auto-delete.
- **Beacon placement accuracy**. The caregiver eyeballs where beacons are. F8's accuracy depends on this. Mitigation deferred to F8 — fingerprint matching is more forgiving than pure trilateration.

---

## Phase 3 — Locate

**Goal**: When the patient is indoors, the dashboard shows a smoothed marker on the floor plan that matches reality within 1.5 m on 80% of samples. When the patient leaves the calibrated space, the view switches to an outdoor map. The switch is hysteretic and doesn't flap at the doorway.

**Entry criteria**

- Phase 2 complete: floor plan + beacons + calibration data exist for the test patient.
- The mock generator publishes signals payloads with realistic RSSI vectors. We need a **scripted RSSI replay** mode for repeatable testing — same as POS-10 ("stress testing with synthetic data"). Add to `tools/mock-telemetry/`.
- Mapbox token in dev env (`VITE_MAPBOX_TOKEN`).

**Critical path**

```
POS-01..POS-07 (the math) ─┐
                            ├── F8 (indoor positioning, ties math to UI)
position_estimator (BE-07) ─┘
                                                 ├── F9 (outdoor map, depends on F8 mode flag)
POS-08 (mode switch hysteresis) ─────────────────┘
```

F8 is the single hardest feature in the build. The math (POS-01..07) ships first as pure functions in `packages/shared/src/positioning/` (yes, shared — both the edge function and any future client-side preview need them). The edge function `position_estimator` glues them together: takes a `signals` payload, fetches beacons + calibration_points for the patient, runs the pipeline, writes a `position_estimates` row.

**Algorithm pipeline** (one signals payload → one position_estimates row):

1. **RSSI → distance** per beacon, using the log-distance path-loss model. Each beacon row carries calibrated `tx_power` and `rssi_at_1m` (added to the `beacons` table in the foundation migration). The path-loss exponent is global per environment; default 2.0, tunable per floor plan.
2. **Trilateration** using the top 3 strongest BLE beacons. Wrap `trilateration.js` in a wrapper that accepts our distance estimates and rejects degenerate (colinear) configurations with high residual error.
3. **Fingerprint match** independently: compose the current BLE+WiFi RSSI vector, compute kNN distance to every `calibration_points` signature for the same `floor_plan_id`, weighted-average the top-k positions.
4. **Fusion**: weighted blend of trilateration + fingerprint, weights chosen by their respective confidence scores (trilateration confidence inversely proportional to residual error; fingerprint confidence inversely proportional to k-th-neighbour distance).
5. **Smoothing**: light Kalman filter or moving average over the last N estimates per patient. Stateless edge functions can't hold history — store the smoothing state in a `position_estimator_state` table keyed by `patient_id`, or carry it via Postgres array on the most recent rows. **Recommendation**: read the last 5 `position_estimates` for the patient, compute smoothed output as the weighted moving average. Stateless, simple, good enough.
6. **Confidence scoring**: combine residual + match quality + signal availability into a 0..1 scalar. Surface to UI as marker opacity.
7. **Insert** the `position_estimates` row.

**Why this pipeline order**: trilateration is geometrically meaningful but noisy; fingerprint is empirically calibrated to _this_ space and forgiving of NLOS / multipath. Blending both buys robustness. Smoothing only at the end so we don't suppress real motion.

**Trigger model**: how does `position_estimator` get invoked? Three options:

- **Database webhook** on `signals` row insert. Clean, decoupled. But requires `signals` to be persisted, which we said earlier we'd avoid for storage cost.
- **Direct invocation from `mqtt_bridge`** when it processes a signals payload. Most efficient — no extra round trip — but couples the bridge to the estimator.
- **Queue + worker** (PgBoss, or just a `signals_queue` table). Overkill for prototype.

**Recommendation**: bridge invokes `position_estimator` directly via internal HTTP after validating the payload. The estimator becomes a regular HTTP-triggered Edge Function. The bridge's own service-role key authenticates the call. This avoids persisting raw signals at the cost of mild coupling.

If the project later needs replay-from-raw-signals (for tuning POS-10 stress tests), persist signals to a dedicated `signals` table that the bridge writes to in addition to invoking the estimator. Defer until Phase 5 / V2.

**F9 outdoor map**: easier feature, mostly Mapbox glue. The interesting bit is the mode switch (POS-08). Hysteresis prevents flapping: only switch to outdoor when GPS confidence > 0.7 _and_ indoor confidence < 0.3 for ≥ 5 s; only switch back when GPS lost for ≥ 5 s.

**Exit criteria**

- Indoor path: walk a known route through the test space; recorded estimate error < 1.5 m on 80% of samples (TST-05).
- Outdoor path: walk a known outdoor route; GPS pin updates within 5 s of fix (TST-06).
- Mode switch: walk in/out the doorway 5 times; no flap (no mode flip in either direction within 5 s of the previous flip).
- Geofence support stub on the map (F9 mentions it; the actual rule-firing belongs to Phase 4).

**Integration tests** (verification gate to Phase 4)

1. **Synthetic RSSI replay**. Pre-record a sequence of signals payloads from a known walk path, replay through the bridge → estimator → DB. Assert error distribution. This is POS-10.
2. **Beacon dropout**. Replay with one beacon's RSSI dropped to -127 mid-test; assert fingerprint matcher recovers the position within 2 estimates.
3. **NLOS spike**. Replay with one beacon's RSSI spiked +20 dB (simulated reflection); assert smoothing dampens the resulting jump.

**Risks**

- **Accuracy target may not be met**. The 1.5 m / 80% target in a real room with cheap BLE beacons and signal-noisy environments is aggressive. Mitigation: scope F7 calibration to dense (8+ points in a 4-room space); pad path-loss model with per-beacon calibration constants; lean on fingerprint match more heavily than pure trilateration. If still missing, document the achieved accuracy honestly in the evaluation report (EV-05) — that's what the project is graded on, not whether we hit a number.
- **Latency under load**. position_estimator runs per signals payload (~1 Hz). For one patient that's 1 invocation/s; trivial. For demos with multiple patients it'd scale linearly. Acceptable for V1.
- **Stateless smoothing limitation**. Reading last-5 rows per invocation works but adds a DB roundtrip. For prototype that's fine; for V2, move to a stateful service.

---

## Phase 4 — Alert

**Goal**: A caregiver tunes per-patient rules in a settings tab, watches a "would have alerted" preview against the last 24 h of data, and receives live alerts in a global bell + per-patient feed. Acknowledgement persists.

**Entry criteria**

- Phases 1–3 deliver `sensor_readings`, `position_estimates`, and (for fall) `events` flowing into the database.
- An `events` ingestion path exists. The bridge already validates `EventMessage` per topic; persistence path needs to be wired (target table: a new `events` table, OR alerts directly with severity from event type). **Recommendation**: a thin `events` table keyed by `patient_id`, `device_id`, `occurred_at`, `type`, `payload` — separate from `alerts` because not every event becomes an alert (e.g. a `connect` event is operational, not clinical). The rules engine reads from `events` for fall detection.

This adds a **migration** in Phase 4: `events` table with composite `(patient_id, occurred_at desc)` index, RLS read-scoped via `is_caregiver_for(patient_id)`, write via service role from the bridge. Document this addition; it wasn't in the foundational 12 tables but it's required to deliver F11's fall rule type cleanly.

**Critical path**

```
events table migration (BE addition)
       ↓
rules_engine (BE-08, real implementation)
       ↓
F11 (settings UI) ─── F12 (feed UI)
```

F11 and F12 can develop in parallel once the rules engine spec is locked. F12 is mostly a consumer of the existing `alerts` table + realtime; F11 is the producer of `alert_rules` rows.

**Rule type taxonomy**:

| Type                  | Trigger                     | Source                                         | State                                    |
| --------------------- | --------------------------- | ---------------------------------------------- | ---------------------------------------- |
| `vitals`              | sensor_readings INSERT      | `sensor_readings`                              | stateless                                |
| `zone`                | position_estimates INSERT   | `position_estimates` + rule's geofence polygon | stateless except for dwell-time check    |
| `fall`                | events INSERT (type=fall)   | `events`                                       | stateless                                |
| `inactivity`          | scheduled (per-minute cron) | `position_estimates` (no movement for N min)   | stateful — needs the _absence_ of motion |
| `repetitive_movement` | (V2 deferred)               | —                                              | —                                        |

**Inactivity is special**. It can't be triggered by an INSERT because it fires on the _absence_ of recent inserts. Two implementation options:

1. **Scheduled Edge Function via pg_cron**. Every minute, for each enabled inactivity rule, query `position_estimates` for the patient's last detected motion, fire if delta > threshold. Adds a pg_cron job per enabled rule (or one job that loops over enabled rules).
2. **Compute-on-write with implicit motion flag**. Each `position_estimates` row carries a derived "moved" boolean (delta from previous > threshold). Separate watchdog process scans for patients with no recent moved=true rows.

Option 1 is cleaner for prototype. Add `pg_cron` extension in a Phase 4 migration. The scheduled function runs every 60 s.

**Alert cooldown** is cross-cutting — see [CROSS_CUTTING.md §3 — Alert cooldowns](./CROSS_CUTTING.md#3-alert-cooldowns). Default windows per severity defined there; per-rule overrides via `alert_rules.params.cooldown_seconds`.

**"Would have alerted" preview** (F11 sub-feature). Re-runs the rule evaluator against the last 24 h of data with the current rule config. This is a pure function over historical data — same evaluator code as the live engine, different data source. Build the evaluator as a pure function in `packages/shared/src/rules/` that takes `(rule, dataPoint, history)` and returns `Alert | null`. Both the live engine and the preview consume the same function. This is a critical SSOT decision — see [CROSS_CUTTING.md §10 — Rule evaluator location](./CROSS_CUTTING.md#10-rule-evaluator-location).

**Exit criteria**

- 5 distinct rule types configurable per patient (zone, vitals, fall, inactivity; repetitive_movement deferred to V2 — document in BACKLOG, don't pad to 5).
- Rule edit takes effect within 30 s (live engine reads enabled rules per evaluation; cache invalidation < 30 s, or no cache at all).
- Alerts surface in the bell within 2 s of being written.
- Acknowledgement persists across reload.
- Audible cue for critical alerts (browser tab audio); visual flash when tab inactive (Notification API).

**Integration tests**

1. **All rule types fire correctly** (TST-09). For each rule type, drive 10 trigger events through the system, assert all 10 land in the alert feed and the timing meets latency.
2. **Geofence breach** (TST-08). Walk the mock-positioned patient across a defined polygon edge in a synthetic signals replay; assert alert fires within 5 s.
3. **Cooldown**. Trigger the same rule rapidly 5 times within the cooldown window; assert exactly one alert fires.
4. **Rule update propagation**. Update an enabled rule's threshold; within 30 s, the new threshold is in effect (no stale cache).
5. **Acknowledgement persistence**. Ack an alert in tab A; tab B (same caregiver) sees the alert disappear from "active" within 2 s.

**Risks**

- **False positive rate** is called out as a critical evaluation metric (EV-05). Prototype rules will be noisy. Mitigation: ship reasonable defaults; the live preview lets caregivers tune before saving; honest reporting in evaluation.
- **pg_cron may not be available** on the Supabase plan — confirm before locking the inactivity design. Fallback: a periodic Edge Function triggered by an external scheduler (Vercel cron, GitHub Actions). Document the chosen path.
- **Rules engine evaluator drift**. If the live evaluator and the preview evaluator diverge, caregivers can't trust the preview. Mitigation: enforce SSOT — single function in `packages/shared/src/rules/`, both consumers import it. Add a Vitest that calls both paths with the same input and asserts identical output.

---

## Phase 5 — Polish

**Goal**: The prototype is demo-ready. Caregiver can scrub history, replay indoor movement, export CSV. Critical paths are accessible. Two demo dry runs land cleanly.

**Entry criteria**

- All preceding features pass their acceptance criteria.
- A 60-minute continuous run was performed (TST-10) without reconnect storms or memory leaks.

**Critical path**

```
F13 (history scrubber + vitals charts + CSV export)
            ↘
             accessibility pass (UI-28)
            ↘
             mobile responsiveness (UI-29)
            ↘
             demo prep (DOC-10..12)
```

These are mostly independent. Recharts gets installed for the vitals charts. Fabric.js already supports the canvas replay (replay = render dots over time on the existing canvas).

**Replay implementation**: pull `position_estimates` for the chosen window, render as a list of `(x_canvas, y_canvas, recorded_at)`. The scrubber is a `<input type="range">` mapped to indices in the list. At 10× playback, advance one row every (recording_interval × 100) ms. For 1 Hz recording, that's a 100 ms tick.

For 24 h × 1 Hz = 86,400 rows. That's 6–8 MB of JSON over the wire. Consider:

- **Pagination**: load the chosen window only, not all 24 h.
- **Decimation**: for windows > 1 h, sample every Nth row server-side. Implement as an RPC: `select_position_estimates(patient_id, from, to, max_points)` that uses `WITH ... SELECT` with `row_number() % stride = 0` to thin.

**Recommendation**: ship simple row-fetch for windows ≤ 1 h (default replay window); add decimation only if the 24 h export view is sluggish.

**CSV export**: client-side. Fetch rows for the chosen range and metric, pipe through a CSV serializer (we don't need a library — `papaparse` is a single dep but native `Blob` + `URL.createObjectURL` is enough for prototype). Surface as a download link.

**Accessibility pass** (UI-28):

- Keyboard nav across roster, dashboard tabs, alert feed, settings forms.
- ARIA labels on canvas-based components — Fabric canvases are notoriously inaccessible; provide a parallel keyboard-shortcut surface (e.g. arrow keys to move a selected marker; "T" to add a calibration point at the cursor).
- Color contrast: validate brand palette pairs (navy/cream, orange/cream) at WCAG AA minimum on all text. The existing tokens should pass; verify with a contrast checker in CI (e.g. axe-core in Playwright if we add e2e).
- Screen reader: live region for the alert bell announcing new criticals.

**Demo prep** (DOC-10..12 from task list):

- Demo script with timing per slide.
- Two dry runs minimum.
- Backup video of the working demo (filmed off-screen, in case live fails).
- Q&A pre-prep per workstream.

**Exit criteria** (the project ships)

- F13 acceptance: replay 1 h at 10× speed; CSV export of last 24 h vitals downloads cleanly.
- Continuous 60-min run (TST-10): no client reconnects, no dropped alerts, no memory growth on the dashboard tab.
- Accessibility: critical paths keyboard-navigable; AA contrast on text; screen-reader announces criticals.
- Demo: two successful dry runs; backup video recorded.

**Risks**

- **Polish work is expansive**. Mitigation: cut accessibility coverage to "critical paths" (auth, roster, viewing a patient, acknowledging an alert). Defer canvas accessibility to V2.
- **Memory leaks under continuous run**. Likely culprits: realtime channels not torn down; sparkline buffers growing; alert feed not capped. Mitigation: write the 60-min run early in Phase 5, fix what surfaces.

---

## Phase summary diagram

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5
foundation   spine      place      locate     alert      polish
            (live      (canvas    (math)     (rules     (history,
             cards)     + cal.)               + feed)    a11y, demo)
                ↑                     ↑                          ↑
            mock gen              POS-10                     60-min run
            adds tele             replay                     before demo
                ↓                     ↓                          ↓
            adds signals          adds events                final integration
```

**Hard prerequisites between phases** are listed at each phase's _Entry criteria_. Soft prerequisites (e.g. F9 outdoor benefits from F8 indoor existing for the mode switch but F9 can develop against a stub) are noted in the per-feature execution sheets.

For who-builds-what at each phase, see [PARALLEL_TRACKS.md](./PARALLEL_TRACKS.md).
