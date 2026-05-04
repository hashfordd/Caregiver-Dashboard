# Parallel tracks

Four SaaS workstreams build the dashboard. They run in parallel within phases, syncing at the verification gates between phases.

| Track           | Workstreams | Owns                                                                                                                    |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Frontend**    | UI          | React app, routing, components, brand, accessibility                                                                    |
| **Backend**     | BE          | Migrations, RLS policies, edge functions, audit log                                                                     |
| **Positioning** | POS         | Math (RSSI → distance, trilateration, fingerprint, fusion, smoothing); shared lib in `packages/shared/src/positioning/` |
| **Integration** | TST         | Mock generators, integration tests, full-chain latency, accuracy harness                                                |

MQ work (broker hosting, ACL automation, monitoring) is mostly Phase 0 done; remaining tasks are small enough to fold into BE.

## Per-phase swim-lanes

The matrix below shows which tracks have active work per phase, what they ship, and the explicit hand-off between them.

### Phase 1 — Spine

| Track           | Work                                                                                                                                                                                                    | Hand-off out                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Frontend**    | F1 signup form + role selection; F2 roster + create-patient; F3 dashboard shell with tabs; F4 sensor cards + sparklines + stale indicator                                                               | Consumes: `caregiver_patient` for roster filter; `sensor_readings` realtime channel for cards                   |
| **Backend**     | F1 RLS write policies (caregivers, patients, caregiver_patient); F10 device pairing endpoint; mqtt_bridge persistence (real, not stub); service-role wiring; events table migration deferred to Phase 4 | Provides: real `mqtt_bridge` accepting telemetry → writing `sensor_readings`; auto-allocation on patient create |
| **Positioning** | (idle — no work in Phase 1)                                                                                                                                                                             | —                                                                                                               |
| **Integration** | `tools/mock-telemetry/` — Node CLI that publishes telemetry payloads to broker on configurable interval; TST-01..03 wired into CI; RLS denial tests                                                     | Provides: deterministic mock data for FE + BE development without firmware                                      |

**Hand-off contracts** (the explicit interfaces between tracks):

- **BE → FE**: `mqtt_bridge` writes to `sensor_readings` with the row shape declared in the migration. FE consumes via `usePatientStream` and the row interface in `apps/web/src/lib/usePatientStream.ts`. No hidden coupling — both sides reference the migration.
- **TST → BE**: mock generator publishes to MQTT topics matching the schema in `packages/shared/src/mqtt/telemetry.ts`. If BE changes the schema, mock generator imports break.
- **BE → TST**: bridge exposes an HTTP entry for CI tests in addition to its long-running mode. TST drives that endpoint with curl + a fixed corpus of telemetry payloads.

**Critical sync point**: when BE has the bridge persisting and FE has the dashboard subscribed, the integration test runs. That's the Phase 1 verification gate.

### Phase 2 — Place

| Track           | Work                                                                                                                                                                                                                                                             | Hand-off out                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Frontend**    | F5 Fabric.js canvas + walls/rooms/furniture + scale calibration + save/load; F6 beacon discovery view + placement; F7 calibration walk UI + capture timer + progress                                                                                             | Consumes: `signals` realtime stream (BE provides) for beacon discovery and calibration capture |
| **Backend**     | Floor plan CRUD with RLS; beacon CRUD; calibration_points write endpoint (RPC: `capture_calibration_point` taking aggregated signature); ensure mqtt_bridge handles signals payloads in addition to telemetry                                                    | Provides: signals data path; RPCs for typed mutations                                          |
| **Positioning** | Define the calibration signature schema (BLE/WiFi RSSI vector format). Stub a `pathLossDistance(rssi, txPower, rssi1m)` function in `packages/shared/src/positioning/` — used by F8 in Phase 3 but its signature is locked here so FE/BE can serialise correctly | Provides: signature shape for `ble_signature` / `wifi_signature` JSONB columns                 |
| **Integration** | Extend mock generator with a `signals` mode publishing realistic BLE+WiFi RSSI vectors; TST coverage for canvas round-trip                                                                                                                                       | —                                                                                              |

**Hand-off contracts**:

- **POS → BE**: signature shape published in `packages/shared/src/positioning/types.ts`. Migration's JSONB columns conform; capture endpoint validates.
- **BE → FE**: signals realtime channel (added to publication if not already), so FE can show live beacon discovery during pairing.
- **FE → BE**: aggregated calibration signature serialised per the shared shape; capture RPC validates and inserts.

### Phase 3 — Locate

| Track           | Work                                                                                                                                                         | Hand-off out                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Frontend**    | F8 marker animation on canvas (consumes `position_estimates` via realtime); F9 Mapbox map + breadcrumb + geofence draw; mode-switch UI based on `mode` field | Consumes: `position_estimates` channel                                                                         |
| **Backend**     | `position_estimator` real implementation (replaces stub); wire bridge → estimator invocation; ensure RLS write for service role                              | Provides: `position_estimates` rows at signals rate                                                            |
| **Positioning** | POS-01..07: log-distance model, trilateration wrapper, kNN fingerprint, fusion, smoothing, confidence; POS-10: synthetic RSSI replay harness                 | Provides: pure-function pipeline used by `position_estimator`; published in `packages/shared/src/positioning/` |
| **Integration** | Replay harness drives the full chain with engineered RSSI sequences; TST-05 indoor accuracy; TST-06 outdoor; mode-switch hysteresis test                     | —                                                                                                              |

**Hand-off contracts**:

- **POS → BE**: `position_estimator` imports the pipeline from `@alzcare/shared/positioning`. POS owns the algorithm; BE owns the orchestration (fetch beacons, fetch calibration, call pipeline, write row).
- **BE → FE**: `position_estimates` rows include `mode`, `confidence`, and either canvas or lat/lng coordinates. FE renders accordingly.
- **TST → POS**: replay harness exercises the pipeline directly (unit-style, no DB) for fast iteration; same data also drives the full-chain integration test.

**Sync point**: TST-05 with > 80% accuracy is the verification gate to Phase 4.

### Phase 4 — Alert

| Track           | Work                                                                                                                                                                            | Hand-off out                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Frontend**    | F11 settings tab + rule cards + live preview; F12 bell + dropdown + per-patient alerts tab + ack flow + audible cue                                                             | Consumes: `alerts` realtime channel; `alert_rules` for settings |
| **Backend**     | `events` table migration (Phase 4 addition); `rules_engine` real implementation; pg_cron job for inactivity; ack RPC (`acknowledge_alert`); cooldown logic per CROSS_CUTTING §3 | Provides: alerts rows; cooldown enforcement                     |
| **Positioning** | (idle — Phase 3 done)                                                                                                                                                           | —                                                               |
| **Integration** | TST-08 geofence; TST-09 alert delivery reliability; cooldown test; rule update propagation test; F11 preview parity test                                                        | —                                                               |

**Hand-off contracts**:

- **BE → FE**: `alerts` rows realtime; `alert_rules` for the settings tab read; `acknowledge_alert` RPC for the ack flow.
- **CROSS-CUTTING § rule evaluator → BE & FE**: `evaluateRule` lives in `packages/shared/src/rules/`. BE imports for live engine; FE imports for preview. Parity test in TST.

### Phase 5 — Polish

| Track           | Work                                                                                                                                                              | Hand-off out |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Frontend**    | F13 history scrubber + vitals charts (Recharts) + CSV export; accessibility pass (UI-28); mobile responsiveness (UI-29)                                           | —            |
| **Backend**     | Optional: retention compactor (CROSS_CUTTING §8) if 60-min run shows volume issues; audit_log RLS policy for admins; storage bucket for floor plan images (BE-10) | —            |
| **Positioning** | (idle)                                                                                                                                                            | —            |
| **Integration** | TST-10 60-min stability run; TST-12 network-drop reconnect; TST-14 caregiver UX walkthrough with non-team participant; demo dry runs                              | —            |

## Track ownership

PM-01 (confirm workstream owners) is unblocked. The plan assumes:

- One owner per track is named.
- Backups for each are named (single-point-of-failure mitigation per the comprehensive task list).
- Standups (PM-03) sync the tracks weekly; verification gates at phase boundaries are go/no-go meetings.

The tracks aren't strict — pair across them where it makes sense. The contract is that the **hand-off interfaces** are stable: shared types in `packages/shared`, realtime channel shapes, RPC signatures. As long as those are stable, the tracks can refactor internally without coordination.

## Common cross-track tasks

These don't fit a single track and rotate among the team:

- Updating `BACKLOG.md` when something is deferred.
- Updating these docs when decisions change.
- Maintaining `.env.example` files when new env vars are introduced.
- Triaging CI failures.
- Demoing the latest slice at the weekly standup.
