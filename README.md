# ENG40011 · Alzheimer's Care Project

Project-level workspace. The application code lives in `codebase/`;
sibling folders hold the firmware, hardware design, and planning
artefacts that aren't part of the npm monorepo.

```
.
├── codebase/             ← npm monorepo (Vite + React + Supabase + Deno edge)
│   └── README.md           ← daily commands live there
├── mqtt-infra/           ← Mosquitto broker config (docker-compose, ACL, certs)
├── mqtt-firmware/        ← ESP32 / Arduino wearable sources
├── hardware/             ← PCB designs, BOMs, mechanical CAD
├── planning/             ← course artefacts, milestone plans, diagrams
└── README.md             ← (this file)
```

## Day-to-day work

Almost everything happens inside `codebase/`:

```bash
cd codebase
npm install            # one-time
npm run dev            # web dashboard
npm run broker:up      # starts Mosquitto from ../mqtt-infra/
npm run typecheck
npm run test
```

See [`codebase/README.md`](./codebase/README.md) for the full setup
guide, daily commands, and architecture overview.

## Sibling areas

- **`mqtt-infra/`** — Mosquitto docker-compose stack, ACL pattern,
  certificate + credential generation scripts. Scoped to broker
  operations only; the bridge code that connects Postgres to MQTT
  lives in `codebase/apps/edge/functions/mqtt_bridge/`.
- **`mqtt-firmware/`** — wearable firmware (separate toolchain — PlatformIO
  / Arduino / ESP-IDF). Empty until the firmware track starts.
- **`hardware/`** — PCB schematics, BOMs, mechanical drawings. Empty
  until the hardware track produces deliverables.
- **`planning/`** — project-level documents that don't belong inside
  the codebase: course-deliverable docs, milestone gantts, demo plans
  not tied to a specific feature.

## Why the split

The codebase needed to move into a subfolder so the project root could
host project-related material (firmware sources, PCB files, course
deliverables) without polluting the `npm` workspace tree, the TypeScript
project, or the CI workflows. Tooling boundaries follow folder
boundaries — `npm install` only resolves inside `codebase/`, prettier
and eslint only see the codebase tree, vercel deploys only what's at
`codebase/`.

The git repo stays at this project-level root so the whole thing
(codebase + firmware + hardware + planning) is versioned together.
