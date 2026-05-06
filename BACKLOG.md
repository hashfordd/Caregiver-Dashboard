# Backlog

Items deferred from the foundational scaffold. Add new entries here rather than expanding scope mid-build.

Format: `- **<area>** — what + why deferred + reference (feature ID / task ID).`

## Deferred during scaffold

- **Vulnerability remediation** — `npm audit` reports 13 transitive vulnerabilities (4 low / 5 moderate / 3 high / 1 critical) at scaffold time. Deferred because `npm audit fix --force` would likely downgrade pinned versions; review individually and patch before any production-shaped deploy.

- **Edge function shared-schema bundling** — `apps/edge/deno.json` resolves `@alzcare/shared/mqtt` via relative path to the workspace source. Works for `deno check` and `supabase functions serve` locally; verify the import graph survives `supabase functions deploy` bundling, or publish `@alzcare/shared` to npm and switch to `npm:` specifiers. (BE-06)

- **`mqtt_bridge` runtime model** — Supabase Edge Functions are request-scoped; a real MQTT subscriber needs a long-running process. The current stub provides the validation shape via HTTP, but the production bridge will likely run as a Deno container on Fly.io or EC2. (BE-06 / MQ-01)

- **RLS write policies** — only read-scoping policies are stubbed. Inserts / updates / deletes need explicit policies once the edge functions write rows under user JWTs (currently they'd run with the service role and bypass RLS). (BE-04)

- **`audit_log` SELECT policy** — RLS is on with no SELECT policy, so the table is currently inaccessible to clients. Add an admin-role SELECT policy when the role system lands. (BE-11 / REG-04)

- **Storage buckets** — `supabase/config.toml` enables Storage but no buckets are created. Bucket + access rules added alongside F5 (floor plan asset uploads). (BE-10)

- **Audit log triggers** — Auto-log triggers on device pairing / beacon placement / rule changes / acknowledgements are TODO. (BE-11)

- **Seed demo data** — `supabase/seed.sql` is an empty placeholder. Demo patient + 4 placed beacons + sample alert rules + 24h synthetic history are TODO. (BE-12)

- **Per-device Mosquitto credentials** — `mqtt/passwd.example` documents the pattern but no automation exists for generating per-device entries during firmware enrollment. (MQ-04 / MQ-05 / FW-19)

- **Mosquitto monitoring + retention** — broker has a healthcheck in docker-compose; no log retention or device-count dashboard yet. (MQ-08)

- **Front-end libs not yet installed** — Mapbox GL JS (F9 outdoor map) and Recharts (F4 sparklines / F13 history charts) are listed in the spec's Library Reference but not in `apps/web/package.json` since no feature uses them yet. Install at the time the relevant feature is built; pin exact versions.

- **Realtime broadcast channel auth** — F6's `patient:<id>:signals` channel relies on namespacing as the auth boundary. Any authenticated caregiver can subscribe to any patient's signals channel; we don't currently enforce that they're allocated to that patient. V2: adopt Supabase Realtime Authorization when it's GA so a caregiver can only join a channel for a patient they're allocated to. Until then, it's a deliberate gap noted in `docs/features/F6.md` Risks. (F6 / SEC-01)

- **F7 calibration: stale-calibration banner** — F5 warns on canvas edits but doesn't auto-invalidate captures. The panel should surface "this point predates a recent canvas edit" by comparing `captured_at` to `floor_plans.created_at`. Adds a join we don't currently surface in the calibration query; defer to V2 once the F8 fingerprint matcher actually consumes calibration data and stale points start mattering. (F7 / UI-08)

- **F7 calibration: per-room density visualisation** — F7.md notes V1 ships count-only; V2 should colour the canvas by density (heatmap of placed points per closed-wall room) so caregivers can see under-sampled rooms before F8 matching runs. Requires a published "closed-room geometry" API from F5 which doesn't currently exist outside `findClosedRooms` in `geometry.ts`. (F7 / UI-09)

- **F7 calibration: quality glyph on placed dots** — Captured points all passed thresholds at write time, so all written rows are "good" — but caregivers may still want to distinguish "barely passed" from "well in spec" visually on the canvas. Render a small quality indicator (e.g. ring colour scale by stddev) on each dot. Requires no schema change. (F7 / UI-10)

- **F8 positioning: beacon calibration sub-flow** — `beacons.tx_power` and `beacons.rssi_at_1m` columns exist but F6 leaves them NULL on insert. F8's path-loss model substitutes `DEFAULT_RSSI_AT_1M = -59` dBm (iBeacon datasheet midpoint) and emits a per-beacon warning. This is the dominant systematic error in the trilateration path; an in-app "stand the wearable 1 m from this beacon, hold for 5 s" capture flow inside the Beacons sub-tab would let caregivers calibrate per-beacon. Tighten when the F8 accuracy report shows the default is the dominant error term. (F8 / POS-02)

- **F8 positioning: full mode-switch hysteresis** — F8.md POS-08 calls for ≥ 5 s of consistent candidate condition before flipping indoor↔outdoor. V1 ships the candidate directly without hysteresis because the recoverable signal from `position_estimates` is the _applied_ mode, not the per-tick candidate. Implementing real hysteresis without per-patient in-memory state requires adding `indoor_confidence` (and possibly `gps_strong`) columns so the orchestrator can count consecutive prior candidates from the row history. Additive migration; F11 zone-rule firing tolerates the V1 single-tick decisions. (F8 / POS-08)

- **F8 positioning: position_estimates retention** — Rows accumulate at ~1 Hz × patients. At one patient × one week that's ~600k rows; at scale a 1-min aggregate compactor (CROSS_CUTTING §8) is needed before any deployment with >1 patient × week of history. (F8 / Phase 5)

- **F8 positioning: real-environment replay fixtures** — `tools/replay-signals/fixtures/walk-1.jsonl` is currently synthesised by reverse-applying the path-loss model + Gaussian RSSI noise. That catches algorithm regressions deterministically but doesn't catch model-vs-physics gaps (multipath, NLOS, body shadowing). Replace with a captured walkthrough recording before EV-05; the synthesised baseline is the algorithmic floor, not the production-accuracy ceiling. Also add per-scenario fixtures (dropout, NLOS, mode-flap) once the real-environment capture pipeline exists. (F8 / TST-14)

- **Husky pre-commit aggressiveness** — `lint-staged` runs ESLint + Prettier on staged files. Add a typecheck stage if false-positive PRs become a problem.

- **Auth signup flow** — `LoginPage` only handles sign-in (password + magic link). Signup with role selection (professional / family) is F1 feature work. (UI-03)

- **Caregiver profile page** — name / contact / role / °C–°F preference is F1 / UI-05 feature work.

- **Peer caregiver chips on the patient header** — F3 currently shows only the
  patient's name, age and connection status. Rendering chips for every
  caregiver allocated to a patient requires either broadening the
  `caregivers` SELECT policy to "visible to a peer who shares a patient" or a
  `SECURITY DEFINER` `get_patient_with_caregivers(patient_id)` RPC. Defer
  until multi-caregiver allocation lands as a feature; V1 has one caregiver
  per patient. (F3 / UI-05)

- **Bridge Dockerfile + docker-compose service entry** — Phase 1 closure
  shipped the long-running Deno bridge (run via `npm run bridge:start`),
  Mosquitto auth (`npm run broker:creds`), and the `mqtt` mode in the
  mock generator. Containerising the bridge so `npm run broker:up`
  brings both up together (and so it deploys to Fly.io as a single image)
  is production hardening — defer to before any non-team deployment.

- **°F unit toggle on sensor cards** — F4 displays temperature in °C only.
  The spec calls for a caregiver preference; F1's profile page didn't ship
  the unit toggle. Add a `temperature_unit: 'c' | 'f'` column on
  `caregivers`, surface in profile, and switch the formatter in
  `SensorCard`. (F4 / UI-05)

- **Recharts deferral note** — Recharts is intentionally not installed
  yet. F4's sparkline is hand-rolled SVG; F13 is the first feature that
  actually needs Recharts (axes, tooltips, range selection). Pin the
  version at F13 install time, then remove the related "Front-end libs
  not yet installed" entry above.

- **Production latency instrumentation** — F4 includes a console-log of
  publish-to-render delta only in dev. Replacing it with a structured
  metric pipeline (e.g. Vercel Analytics / Logflare ingest) is a Phase 5
  / production-hardening item.

- **Realtime broadcast channel auth** — Supabase Realtime broadcast channels (used by F6 for live signals delivery from `mqtt_bridge` to the dashboard) are not RLS-protected in V1. Channels are namespaced by `patient_id` but a determined client could subscribe to any channel name. Acceptable for V1 because dashboard subscribers are authenticated caregivers and the data on the channel (raw RSSI vectors) is low-sensitivity, but tighten when Supabase Realtime Authorization goes GA. (See [docs/CROSS_CUTTING.md §7](./docs/CROSS_CUTTING.md#7-realtime-patterns).)

## Recommended first feature: F1 closure → F2 (Patient Roster)

The DB scaffolding for F1 is in place (`caregivers` table + `handle_new_user` trigger + RLS read-scoping). To finish F1 and unblock the spine:

1. Add `/signup` route with role selection (professional / family); pass role via Supabase `signUp({ options: { data: { role, full_name } }})` so the `handle_new_user` trigger picks it up.
2. Add `/profile` page that reads/updates `caregivers` (RLS self-update policy is already in place).
3. Add a small admin/test seed inserting a `caregiver_patient` row so the new user has a patient to see — or hold this until F2 is built.
4. Vitest: assert `is_caregiver_for(<unrelated_uuid>) = false` and self-allocated = true.
5. Smoke-test in browser: signup → profile → sign out → sign in → magic-link path.

Then build **F2 (patient roster)** — it's the first thing a logged-in caregiver actually sees post-login, and unblocks **F3 (patient dashboard shell)** which unblocks all downstream features.
