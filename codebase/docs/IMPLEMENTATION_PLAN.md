# Implementation Plan

Living document. The team works from this. Update it as decisions land or assumptions change.

## How to read this

- **[PHASES.md](./PHASES.md)** — phase-by-phase plan (Phases 0 → 5). Each phase has entry criteria, exit criteria, the verification gate that unblocks the next phase, and the features it ships.
- **[CROSS_CUTTING.md](./CROSS_CUTTING.md)** — decisions that span features. RLS write policies, MQTT versioning, alert cooldowns, error/loading/empty patterns, time handling, retention, observability. Decide once, apply everywhere.
- **[PARALLEL_TRACKS.md](./PARALLEL_TRACKS.md)** — which workstreams can run simultaneously per phase, with the explicit hand-off contracts between them.
- **[features/F1.md](./features/F1.md)..[features/F13.md](./features/F13.md)** — per-feature execution sheets. Self-contained: spec acceptance criteria, files to create/modify (paths from our scaffold), contracts in `packages/shared`, tests, risks, definition of done. A teammate should be able to ship any feature from the doc without re-reading the spec.

## Scope of this plan

**SaaS-only** — Backend (`BE`), MQTT (`MQ`), indoor positioning (`POS`), caregiver dashboard (`UI`), integration & testing (`TST`). Hardware (`HW`), firmware (`FW`), evaluation (`EV`), regulatory (`REG`), and documentation (`DOC`) workstreams from the comprehensive task list are referenced where they're a hard dependency on the SaaS path, but they're owned and tracked elsewhere.

V1 prototype scope per the build spec. V2 items (ML-driven thresholds, SLAM mapping, multi-tenant facility admin, native mobile, FHIR export) are explicitly deferred — see [BACKLOG.md](../BACKLOG.md).

## Status snapshot

- **Phase 0 — Foundation**: ✅ Complete.
- **Phase 1 — Spine**: ✅ Complete (F1, F2, F3, F4, F10).
- **Phase 2 — Place**: ✅ Complete (F5, F6, F7).
- **Phase 3 — Locate**: ✅ Complete (F8, F9, POS-08 hysteresis, in-app beacon calibration).
- **Phase 4 — Alert**: ✅ Complete (F11, F12 — shared evaluator + parity canary, rules_engine + inactivity_scan + cron, settings UI with 4 rule cards + 24 h preview, global bell + per-patient feed + ack RPC + critical cues).
- **Phase 5 — Polish**: in progress. F13 (history tab: vitals charts, position replay scrubber, CSV export, date-range + alert filters) ✅ built, wired, tested. Accessibility: Place workspace on full WAI-ARIA tabs (keyboard nav) ✅. Demo script refreshed to the current build (2 Place bundles, HR-only vitals, click-to-place doors/windows) ✅. Real-hardware acceptance: turnkey runbook at `docs/test-plans/HW-01-hardware-acceptance.md` ✅ — the run itself needs physical ESP32 + beacons (manual). Remaining (require people/hardware, not code): execute HW-01 on real devices + the two demo dry-run sign-offs.
- **Place tab** (post-Phase-3 UX): consolidated into one `features/place/PlaceWorkspace` — a single persistent canvas with two bundles (Floor plan & rooms / Beacons & calibration); doors/windows are placed by clicking on the canvas (Door/Window tools). Vitals degraded to HR-only (firmware emits no SpO₂/temp).
- **Live integration verified** (2026-05-29, sim → HiveMQ → shim → bridge → DB): HR→vitals alert and fall→critical alert proven end-to-end against hosted Supabase; one fall event ⇒ exactly one critical alert after the bridge dedup fix. Indoor positioning pipeline produces estimates on varied RSSI (3,675 historical rows); real-hardware acceptance is the remaining manual step.

## Conventions

Throughout these docs:

- **Feature IDs** are `F1`–`F13` from the spec catalogue.
- **Task IDs** are `<workstream>-NN` from the task list (e.g. `BE-08`, `UI-09`, `POS-03`).
- **File paths** are relative to the repo root unless noted.
- **TODO markers** in code reference the feature ID: `// TODO: F8 — implement trilateration solver`.
- **Definition of done** for any feature requires: lint clean, typecheck clean, tests added and passing, build clean, manual smoke against a running stack, and acceptance criteria met.

## Updating this plan

- Land a decision via PR that touches the relevant doc plus the code/migration that implements it.
- If a feature decomposes differently from how its file describes it, update the file in the same PR — don't let the doc drift.
- Cross-cutting changes go in `CROSS_CUTTING.md` first, then propagate to the feature files that consume the change.
