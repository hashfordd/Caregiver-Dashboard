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

- **Phase 0 — Foundation**: ✅ Complete. Monorepo, Supabase migration applied + verified end-to-end, MQTT broker config, edge function stubs, web scaffold with auth + protected routing + `usePatientStream`, CI/CD, docs.
- **Phase 1 — Spine**: not started. Ready to begin when F1 closure is owned.
- **Phases 2–5**: not started.

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
