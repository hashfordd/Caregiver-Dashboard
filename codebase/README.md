# ENG40011 · Caregiver Dashboard SaaS

Caregiver-side software for the ENG40011 Alzheimer's Care Device. Wearable telemetry plus BLE/WiFi positioning signals stream over MQTT, land in Supabase via an edge function, and surface in a React dashboard via Realtime. The build spec and workstream task list are course artefacts held outside this repo.

> **Status:** Phase 4 closed (F1–F12 shipped — auth + caregiver profile, patient roster + detail, device pairing, live telemetry + sensor cards, floor-plan editor, beacons + calibration, indoor position estimator with POS-08 hysteresis, outdoor map + geofence, alert rules + feed). Phase 5 (reports/demo polish) is outstanding. See [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) for current phase status and [BACKLOG.md](./BACKLOG.md) for deferred items.

For implementation planning, start at [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) — it indexes the phase-by-phase plan ([PHASES.md](./docs/PHASES.md)), cross-cutting decisions ([CROSS_CUTTING.md](./docs/CROSS_CUTTING.md)), workstream parallelism ([PARALLEL_TRACKS.md](./docs/PARALLEL_TRACKS.md)), and the per-feature execution sheets in [docs/features/](./docs/features/).

## Repo layout

This file describes the npm monorepo at `Saas/codebase/`. The wider
project layout is one level up — see [`../README.md`](../README.md)
for sibling areas (firmware, hardware, planning) that live alongside
the codebase but are not part of the npm workspace.

```
codebase/                  ← npm monorepo root (where you `npm install`)
├── apps/
│   ├── web/               # Vite + React + TS + Tailwind + Shadcn dashboard
│   └── edge/              # Supabase Edge Functions (Deno): mqtt_bridge, position_estimator, rules_engine, inactivity_scan
├── packages/
│   └── shared/            # Zod schemas + inferred TS types — SSOT for MQTT contracts, DB row shapes, rule + positioning types
├── supabase/              # CLI config + migrations; functions/ is a symlink to apps/edge/functions
├── tools/                 # CLI utilities (seed, mock-telemetry, replay-signals)
├── docs/                  # Phase docs, feature execution sheets, demo prep, test plans
├── .github/workflows/     # CI (lint, typecheck, test, build, CodeQL, dependency review)
└── vercel.json            # Vercel deploy config for apps/web
```

Sibling areas at the project root:

```
../mqtt-infra/             ← Mosquitto docker-compose + ACL + cert/cred scripts
../mqtt-firmware/          ← ESP32 / Arduino sources (separate scope)
../hardware/               ← PCB designs, BOMs (separate scope)
../planning/               ← project-level docs, diagrams, milestone plans
```

The `npm run broker:*` scripts in this `package.json` reach across
to `../mqtt-infra/` for the broker config; everything else stays
within `codebase/`.

## Prerequisites

- **Node.js 20.x** — `nvm use` will pick up `.nvmrc`
- **npm 10+**
- **Docker Desktop** — for Mosquitto + the Supabase local stack
- **Supabase CLI** — `brew install supabase/tap/supabase`
- **Deno** — for edge function typechecks; `brew install deno`

## First-time setup

```bash
# 1. Install monorepo deps
npm install

# 2. Generate Mosquitto self-signed certs + passwd/acl (one-time)
npm run broker:certs
npm run broker:creds

# 3. Web env vars
cp apps/web/.env.example apps/web/.env.local
# Fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (from `supabase status` after start)

# 4. Bridge env vars
cp apps/edge/.env.example apps/edge/.env
# Fill SUPABASE_SERVICE_ROLE_KEY (from `supabase status`); MQTT_PASSWORD defaults match broker:creds.
```

## Daily commands

```bash
# Supabase (Postgres + Auth + Realtime + Studio at localhost:54323)
npm run supabase:start
npm run supabase:reset    # apply migrations / reset DB

# MQTT broker
npm run broker:up
npm run broker:logs
npm run broker:down

# Long-running bridge (subscribes to broker, persists telemetry)
npm run bridge:start      # leave running in its own terminal

# Dashboard dev server (http://localhost:5173)
npm run dev

# Mock telemetry — three modes, see tools/mock-telemetry/README.md
SB_SERVICE_KEY=… npm run -w @alzcare/mock-telemetry start -- \
  --patient-id <uuid> --device-id <uuid> --mode mqtt --interval 1000

# Tear down
npm run supabase:stop
```

## Verifying

```bash
npm run lint        # eslint across the monorepo
npm run typecheck   # tsc + deno check across all workspaces
npm run test        # vitest in shared/edge/web
npm run build       # production build (apps/web)
```

## Edge function deployment

Functions live in `apps/edge/functions/` and are exposed to the Supabase CLI via the `supabase/functions` symlink. The import map at `apps/edge/deno.json` maps `@alzcare/shared/mqtt` to the workspace source.

```bash
npm run -w @alzcare/edge deploy:all
```

## Frontend deployment (Vercel)

`vercel.json` at the repo root drives the build (`apps/web/dist` output). Set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (and `VITE_MAPBOX_TOKEN` if the outdoor map is in use) in the Vercel project's environment variables.

Preview deploys per PR are handled by Vercel's GitHub App **independently** of this repo's GitHub Actions `verify` workflow. CI lints/typechecks/tests/builds but does not gate Vercel; configure required status checks in the GitHub repo settings if you want CI to block bad previews.

The Mapbox token is a public `pk.*` token shipped in the client bundle. To prevent unrestricted reuse, configure a URL/origin allowlist on the Mapbox account dashboard covering your production domain plus the Vercel preview wildcard (`*.vercel.app` or your team's preview domain).

## Architecture cheat-sheet

- **MQTT topics**: `device/{patient_id}/{telemetry|signals|events}`, enforced via Mosquitto ACL pattern.
- **Type contracts**: every MQTT message validated against Zod schemas in `packages/shared`; Vite and Deno consume the same TS source via path alias / import map.
- **Realtime**: dashboard subscribes to Supabase Realtime channels (`patient:<uuid>`); the broker is the ingestion-side scaling story (AWS IoT Core swap-in path, see MQ-09).
- **RLS**: caregivers see patients allocated via `caregiver_patient`. Read-scoping policies are stubbed; write policies are TODO (see BACKLOG).
