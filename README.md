# ENG40011 · Caregiver Dashboard SaaS

Caregiver-side software for the ENG40011 Alzheimer's Care Device. Wearable telemetry plus BLE/WiFi positioning signals stream over MQTT, land in Supabase via an edge function, and surface in a React dashboard via Realtime. The build spec and workstream task list are course artefacts held outside this repo.

> **This repo is currently the foundational scaffold only.** Features are stubbed with `// TODO: F<n>` markers tied to the spec's feature catalogue (F1–F13). See [BACKLOG.md](./BACKLOG.md) for what's deferred and the recommended first feature to build.

For implementation planning, start at [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) — it indexes the phase-by-phase plan ([PHASES.md](./docs/PHASES.md)), cross-cutting decisions ([CROSS_CUTTING.md](./docs/CROSS_CUTTING.md)), workstream parallelism ([PARALLEL_TRACKS.md](./docs/PARALLEL_TRACKS.md)), and the per-feature execution sheets in [docs/features/](./docs/features/).

## Repo layout

```
.
├── apps/
│   ├── web/            # Vite + React + TS + Tailwind + Shadcn dashboard
│   └── edge/           # Supabase Edge Functions (Deno): mqtt_bridge, position_estimator, rules_engine
├── packages/
│   └── shared/         # Zod schemas + inferred TS types — single source of truth for MQTT contracts
├── supabase/           # CLI config + migrations; functions/ is a symlink to apps/edge/functions
├── mqtt/               # Mosquitto docker-compose, ACL pattern, cert generation script
├── .github/workflows/  # CI (lint, typecheck, test, build)
└── vercel.json         # Vercel deploy config for apps/web
```

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

# 2. Generate Mosquitto self-signed certs (one-time)
npm run broker:certs

# 3. Create the Mosquitto passwd file with at least the bridge account
docker run --rm -v "$PWD/mqtt:/m" eclipse-mosquitto:2.0.20 \
  mosquitto_passwd -c -b /m/passwd backend-bridge changeme

# 4. Copy the ACL template
cp mqtt/acl.example mqtt/acl

# 5. Web env vars
cp apps/web/.env.example apps/web/.env.local
# Fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (from `supabase status` after start)
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

# Dashboard dev server (http://localhost:5173)
npm run dev

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

`vercel.json` at the repo root drives the build (`apps/web/dist` output). Set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in the Vercel project's environment variables; previews auto-build per PR via the GitHub Actions workflow.

## Architecture cheat-sheet

- **MQTT topics**: `device/{patient_id}/{telemetry|signals|events}`, enforced via Mosquitto ACL pattern.
- **Type contracts**: every MQTT message validated against Zod schemas in `packages/shared`; Vite and Deno consume the same TS source via path alias / import map.
- **Realtime**: dashboard subscribes to Supabase Realtime channels (`patient:<uuid>`); the broker is the ingestion-side scaling story (AWS IoT Core swap-in path, see MQ-09).
- **RLS**: caregivers see patients allocated via `caregiver_patient`. Read-scoping policies are stubbed; write policies are TODO (see BACKLOG).
