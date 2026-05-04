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

- **Front-end libs not yet installed** — Fabric.js (F5 floor plan), Mapbox GL JS (F9 outdoor map), Recharts (F4 sparklines / F13 history charts) are listed in the spec's Library Reference but not in `apps/web/package.json` since no feature uses them yet. Install at the time the relevant feature is built; pin exact versions.

- **Husky pre-commit aggressiveness** — `lint-staged` runs ESLint + Prettier on staged files. Add a typecheck stage if false-positive PRs become a problem.

- **Auth signup flow** — `LoginPage` only handles sign-in (password + magic link). Signup with role selection (professional / family) is F1 feature work. (UI-03)

- **Caregiver profile page** — name / contact / role / °C–°F preference is F1 / UI-05 feature work.

## Recommended first feature: F1 closure → F2 (Patient Roster)

The DB scaffolding for F1 is in place (`caregivers` table + `handle_new_user` trigger + RLS read-scoping). To finish F1 and unblock the spine:

1. Add `/signup` route with role selection (professional / family); pass role via Supabase `signUp({ options: { data: { role, full_name } }})` so the `handle_new_user` trigger picks it up.
2. Add `/profile` page that reads/updates `caregivers` (RLS self-update policy is already in place).
3. Add a small admin/test seed inserting a `caregiver_patient` row so the new user has a patient to see — or hold this until F2 is built.
4. Vitest: assert `is_caregiver_for(<unrelated_uuid>) = false` and self-allocated = true.
5. Smoke-test in browser: signup → profile → sign out → sign in → magic-link path.

Then build **F2 (patient roster)** — it's the first thing a logged-in caregiver actually sees post-login, and unblocks **F3 (patient dashboard shell)** which unblocks all downstream features.
