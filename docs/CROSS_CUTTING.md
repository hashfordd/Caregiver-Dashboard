# Cross-cutting concerns

Decisions that span features. Decide once, apply everywhere. When a feature spec disagrees with a decision here, this document wins — update the feature doc to match.

These are the seams along which the build stays coherent. A feature that quietly invents its own pattern for, e.g., loading states or alert cooldowns is a future bug.

## 1. RLS write policies

The foundation migration installed read-scoping policies via the `is_caregiver_for(patient_id)` helper. Writes are deliberately undefined — they're feature-specific.

**The pattern**: every table gets a write policy that names exactly the actor allowed to insert/update/delete.

Roles in play:

- `authenticated` — a logged-in caregiver, identified by `auth.uid()`. RLS sees them.
- `service_role` — the bridge / position_estimator / rules_engine / scheduled jobs. RLS is **bypassed** entirely. Used only on the server side.
- `anon` — never used for writes in V1. Reads only on tables that have an `anon` policy (none currently do).

**Per-table write rules**:

| Table                       | Insert                                                                                           | Update                                                                         | Delete                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `caregivers`                | trigger only (signup)                                                                            | self (`id = auth.uid()`)                                                       | trigger only (cascade)                                 |
| `patients`                  | self (creator auto-allocated; sets `primary_caregiver_id = auth.uid()`)                          | allocated caregivers                                                           | allocated caregivers (with confirm dialog client-side) |
| `caregiver_patient`         | allocated caregiver (to add another caregiver) OR creator (auto-allocate self on patient create) | none                                                                           | self for own row                                       |
| `devices`                   | allocated caregiver (pair flow)                                                                  | allocated caregiver                                                            | allocated caregiver                                    |
| `floor_plans`               | allocated caregiver                                                                              | allocated caregiver                                                            | allocated caregiver                                    |
| `beacons`                   | allocated caregiver                                                                              | allocated caregiver                                                            | allocated caregiver                                    |
| `calibration_points`        | allocated caregiver                                                                              | allocated caregiver                                                            | allocated caregiver                                    |
| `sensor_readings`           | service_role only                                                                                | none                                                                           | service_role only (retention)                          |
| `position_estimates`        | service_role only                                                                                | none                                                                           | service_role only (retention)                          |
| `events` (added in Phase 4) | service_role only                                                                                | none                                                                           | service_role only                                      |
| `alert_rules`               | allocated caregiver                                                                              | allocated caregiver                                                            | allocated caregiver                                    |
| `alerts`                    | service_role only (rules_engine writes)                                                          | allocated caregiver (ack only — sets `acknowledged_at`, `ack_by_caregiver_id`) | none                                                   |
| `audit_log`                 | trigger only                                                                                     | none                                                                           | none                                                   |

**Implementation pattern** (each policy is a separate migration, or batched per phase):

```sql
create policy <table>_allocated_insert on public.<table>
  for insert with check (public.is_caregiver_for(patient_id));

create policy <table>_allocated_update on public.<table>
  for update using (public.is_caregiver_for(patient_id))
  with check (public.is_caregiver_for(patient_id));
```

Use `with check` on every insert/update — it's the row-after-write check. Without it, a caregiver could update a row they own to point at a patient they don't.

**Service-role usage rules**:

- Service role key never reaches the browser. Live in env on the server (the bridge), never in `apps/web`.
- Add a CI grep rule: `! grep -r "SERVICE_ROLE" apps/web/`.
- Edge functions that mutate ingestion tables instantiate their own Supabase client with the service role key, separate from any client constructed from caller-passed JWTs.

**Acknowledgement is the one exception** in the alerts table. Caregivers can update `acknowledged_at` and `ack_by_caregiver_id`, but no other columns. Express this in the policy:

```sql
create policy alerts_caregiver_ack on public.alerts
  for update using (public.is_caregiver_for(patient_id))
  with check (
    public.is_caregiver_for(patient_id)
    and severity = (select severity from alerts where id = alerts.id)
    -- ...etc, all immutable columns checked
  );
```

In practice: write a SECURITY DEFINER stored function `acknowledge_alert(alert_id)` that the client calls via RPC. The function checks allocation, sets `acknowledged_at = now()` and `ack_by_caregiver_id = auth.uid()`, returns the updated row. This is more robust than column-level RLS.

**Worked example — claim-but-don't-steal updates** (the `devices` pattern from F10):

```sql
create policy devices_pair_or_update on public.devices
  for update using (
    paired_patient_id is null
    or public.is_caregiver_for(paired_patient_id)
  )
  with check (public.is_caregiver_for(paired_patient_id));
```

The two-clause shape is load-bearing: `using` lets a caregiver target an unpaired device (so they can claim it); `with check` requires the row _after_ the update to point at a patient they're allocated to (so they can't steal a paired device by overwriting `paired_patient_id`). Same shape works any time a row has a "pre-claim null" state.

**SECURITY DEFINER for multi-row mutations**: any time a single user action writes to two or more tables and the authorisation depends on the result of the first write (e.g. F2's `create_patient_with_allocation`, F10's `pair_device`), prefer a SECURITY DEFINER RPC over a client-side two-step. It closes the race window where a caregiver creates a patient but fails to allocate themselves, and centralises the authorisation check in one server-side place.

## 2. MQTT message versioning

Every message has `v: 1` as its first field. The bridge dispatches on `v` to the appropriate Zod schema.

**Bumping the version**:

- Breaking change to a message shape (renamed field, removed field, changed type) → bump `v` to 2.
- Add a `v: 2` schema to `packages/shared/src/mqtt/`.
- The bridge keeps both `v: 1` and `v: 2` parsers active until firmware (FW-13) confirms cutover, plus a one-week grace period for any orphaned devices.
- Drop `v: 1` parsing only when the audit log shows zero `v: 1` messages received over a 24 h window.

**Adding new optional fields** is not a breaking change. Existing schemas in `packages/shared/src/mqtt/` use `.optional()` on new fields; older firmware that doesn't send them still parses.

**Adding new event types** in `EventMessage`'s enum — strictly speaking it's a breaking change for the schema (a TS narrow widens), but in practice the bridge can ignore unknown types in a `default: log-and-skip` branch. Add the type to the enum, ship the bridge update first, then the firmware.

## 3. Alert cooldowns

Default cooldown windows per severity, used by `rules_engine` when deciding whether to insert a new alert row:

| Severity   | Default cooldown |
| ---------- | ---------------- |
| `info`     | 15 min           |
| `warn`     | 5 min            |
| `critical` | 1 min            |

Per-rule override via `alert_rules.params.cooldown_seconds` (number). Implementation: in `rules_engine`, for each evaluated rule that matched, query `select max(fired_at) from alerts where patient_id = $1 and rule_id = $2 and acknowledged_at is null`. If `now() - max(fired_at) < cooldown`, suppress. Otherwise insert.

Why query unacked specifically: an old acknowledged alert shouldn't suppress a new firing. The cooldown's job is to avoid storms of identical unhandled alerts — once acknowledged, the caregiver has seen the issue.

**Cross-feature interaction**: F11's "would have alerted" preview must use the same cooldown logic as the live engine. Single source: `packages/shared/src/rules/cooldown.ts`.

**Cooldown reset on rule re-enable**: when a caregiver toggles a rule off and back on, the cooldown should not silently suppress the next firing. Implement by gating the cooldown query with `fired_at >= alert_rules.updated_at` — toggling enable bumps `updated_at`, which excludes pre-toggle alerts from the cooldown window. Same trick handles threshold edits: editing a vitals rule shouldn't be suppressed by the previous threshold's recent alert.

## 4. Loading / empty / error / stale states

Every data-bearing component handles four states explicitly:

- **Loading** — `<Skeleton>` placeholder matching the eventual component dimensions. Don't show spinners except for sub-second mutations.
- **Empty** — friendly message + next-step CTA (e.g. "No patients allocated. Create one →"). Never an empty card.
- **Error** — friendly message + retry button. Show the actual error in development (`import.meta.env.DEV`) and a generic "Something went wrong" in production.
- **Stale** — the data is loaded but no longer fresh. F4's 30 s threshold for live sensor cards is the canonical case. UI shows a yellow pip + "Last updated 47 s ago".

The `Skeleton` and `EmptyState` components are added to `apps/web/src/components/ui/` when the first feature consumes them (likely F2 for empty state, F4 for skeleton). Both follow shadcn idioms.

**Stale-data check pattern**: every realtime-driven component subscribes via `usePatientStream`. The hook tracks the timestamp of the last received message per channel and exposes a `lastSeen` map. Components compute `isStale = now - lastSeen[channel] > threshold` and render accordingly.

## 5. Time handling

- All timestamps stored as `timestamptz` (UTC). The migration uses this throughout.
- All wire formats are ISO 8601 strings with `Z` suffix (UTC). The Zod schemas validate via `.datetime()`.
- The dashboard renders in the **caregiver's local timezone**. Single util `formatTimestamp(iso, format)` in `apps/web/src/lib/time.ts` wraps the formatting (we'll use `Intl.DateTimeFormat`, no library needed for prototype).
- Durations and "time since" use `Date.now() - new Date(iso).getTime()`. Don't subtract Date objects directly; TypeScript discourages it but it works inconsistently.

## 6. Canvas state pattern

Floor plans use Fabric.js. The principle: **addressable entities live in tables, decorative geometry lives in JSONB**.

| Concern                      | Storage                                                   | Reason                                                                   |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Walls, rooms, doors          | `floor_plans.canvas_json`                                 | Decorative; serialised as a unit; never queried for their own attributes |
| Furniture (bed, chair, etc.) | `floor_plans.canvas_json`                                 | Same as above; useful for V2 behavioural ML context                      |
| Beacons                      | `beacons` table; `(x_canvas, y_canvas)` columns           | Addressable (paired with a MAC, queried for triangulation)               |
| Calibration points           | `calibration_points` table                                | Addressable (queried by `floor_plan_id`, used in fingerprint matching)   |
| Patient marker               | not stored — derived from latest `position_estimates` row | Live; not part of the saved floor plan                                   |

`scale_meters_per_pixel` lives on `floor_plans` and is derived once during F5 floor-plan setup (caregiver inputs a measurement; the canvas computes the ratio).

**Canvas mutation policy**: when the caregiver edits the underlying `canvas_json` shape (e.g. moves a wall), the addressable entities (beacons, calibration*points) keep their canvas coordinates but the \_meaning* of those coordinates may change. UX warns when calibrations exist on edit; doesn't auto-invalidate (the caregiver may be making a small fix that doesn't affect signal propagation).

## 7. Realtime patterns

- One canonical hook: `usePatientStream(patientId, callbacks)` in `apps/web/src/lib/usePatientStream.ts`. All realtime consumption goes through it.
- **Mount point**: the hook is mounted **once per patient detail route**, not per component. F3's `PatientStreamContext` provides the callbacks downward via React context so F4 (sensor cards), F8 (position marker), and F12 (per-patient alerts tab) all consume the same subscription. Mounting in each component would create N parallel subscriptions and cause tab-switch resubscribes.
- Channel naming: `patient:<uuid>` for postgres_changes; `patient:<uuid>:signals` for the broadcast channel below. Per-patient subscriptions are scoped via `filter: patient_id=eq.<uuid>`.
- Subscriptions tear down on unmount and on patient change (the hook's effect dep array includes `patientId`); cleanup must `removeChannel` _both_ the postgres_changes channel and the broadcast channel.
- Reconnection is handled by the Supabase JS client. The hook exposes `status` (subscribed/disconnected/error); UI surfaces `disconnected` as a status pill in the patient header.

**Two realtime modes, by data lifecycle**:

| Data                                              | Mode               | Channel                  | Why                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sensor_readings`, `position_estimates`, `alerts` | `postgres_changes` | `patient:<uuid>`         | Persisted; clients can replay missed inserts on reconnect via the table                                                                                                               |
| `signals` (BLE/WiFi RSSI snapshots)               | `broadcast`        | `patient:<uuid>:signals` | Deliberately not persisted (storage cost; raw signals are consumed and discarded by the position estimator). The bridge re-broadcasts each validated message after the position write |

The bridge holds the service-role key and uses it to broadcast — service-role broadcasts bypass channel auth in V1. Channels are namespaced by `patient_id` but the broadcast itself is not RLS-protected; this is acceptable because dashboard subscribers are authenticated caregivers who can only act on patients via separately-scoped RLS-protected reads/writes. **Tighten when Supabase Realtime Authorization goes GA — see BACKLOG.**

**Live data vs. server state**:

- **Live data** (sensor cards, position marker, alert bell new-arrivals): Zustand store (`apps/web/src/lib/stores/`), one slice per concern. The realtime hook writes to the store; components subscribe to slices.
- **Server state** (patient list, alert rules, floor plans, history queries): React Query. Cache key includes patient ID. Realtime invalidations trigger `queryClient.invalidateQueries` for the relevant key.

This split avoids React Query thrashing on 1 Hz updates (which would happen if live data went through it).

## 8. Telemetry retention

`sensor_readings` and `position_estimates` grow fast. Retention strategy:

| Window    | Storage                                                                     | Purpose                          |
| --------- | --------------------------------------------------------------------------- | -------------------------------- |
| 0–7 days  | raw rows in `sensor_readings` / `position_estimates`                        | Live UI; recent history scrubber |
| 7–30 days | 1-min bucketed aggregates in `sensor_readings_1m` / `position_estimates_1m` | Long-range charts                |
| > 30 days | archive (cold storage / object store) or delete                             | Compliance per REG-06            |

For V1 prototype: retention is **not implemented** beyond the schema readiness. A nightly Edge Function (`retention_compactor`) becomes a Phase 5 add-on if data volume in the demo run is non-trivial. The acceptance is "the migration leaves room for retention without rework" — which it does, since adding aggregate tables is additive.

The 1-min aggregates are computed via a continuous aggregate (TimescaleDB) or a periodic SQL job (vanilla Postgres). Vanilla path is fine for prototype:

```sql
insert into sensor_readings_1m (patient_id, bucket_start, hr_avg, ...)
select patient_id, date_trunc('minute', recorded_at), avg(hr_bpm), ...
from sensor_readings
where recorded_at >= '...' and recorded_at < '...'
group by 1, 2;
```

**Decision deferred until Phase 5**. Keep this section as the design target.

## 9. Logging + observability

- **Edge function logs**: Supabase logs (`supabase functions logs <name>`); structured JSON via `console.log(JSON.stringify({ level, msg, context }))`.
- **Broker logs**: Mosquitto's log file under `mqtt/log/`; useful for ACL violations and connection issues.
- **Client errors**: console in development. For prototype demo, a simple `window.onerror` handler that POSTs to a `client_errors` Edge Function table is enough. Not in the original task list — add to BACKLOG.
- **Realtime channel status**: surfaced in UI as a status pill (Cross-cutting §7).
- **Audit log**: see `audit_log` table (BE-11). Triggers fire on device pairing, beacon placement, rule changes, acknowledgement actions. Read by admins (RLS deferred until role system lands).

Minimum bar for V1: any failure in the alert path (rule didn't evaluate, alert didn't write, alert didn't deliver) must be visible in _some_ log. Test this explicitly in Phase 4.

## 10. Rule evaluator location

The rules engine evaluator is a pure function:

```ts
type EvaluatorResult = { fire: true; severity: AlertSeverity; context: Json } | { fire: false };
function evaluateRule(
  rule: AlertRule,
  dataPoint: DataPoint,
  history: HistoryWindow,
): EvaluatorResult;
```

Lives in `packages/shared/src/rules/`. Both consumers import it:

- **Live engine** (`apps/edge/functions/rules_engine/index.ts`): triggered per data row, calls `evaluateRule`, applies cooldown, writes alert if firing.
- **Preview** (F11's "would have alerted" UI): calls `evaluateRule` over historical rows, returns the would-have-fired list to the dashboard.

Single source of truth means a Vitest can drive both consumers with the same input and assert identical output. Required test:

```ts
describe('evaluator parity', () => {
  it('live engine and preview produce identical results', async () => {
    // Seed a patient with 24h of vitals.
    // Run the live engine across that data (or simulate via DB webhook calls).
    // Run the preview against the same data.
    // Assert array-equal.
  });
});
```

This test is the canary — if it ever fails, someone forked the evaluator. Fix immediately.

## 11. Edge function runtimes (Deno vs. long-running)

Three edge functions, two runtime models:

| Function             | Runtime                                      | Why                                            |
| -------------------- | -------------------------------------------- | ---------------------------------------------- |
| `position_estimator` | Supabase Edge Function (request-scoped Deno) | Stateless per-payload; latency-tolerant (1 Hz) |
| `rules_engine`       | Supabase Edge Function (request-scoped Deno) | Stateless; triggered by DB webhook or cron     |
| `mqtt_bridge`        | Long-running Deno on Fly.io / EC2            | Subscribes to MQTT — a long-lived connection   |

`mqtt_bridge` has both an HTTP entry point (used in CI tests) and a long-running entry point (production). The persistence/validation logic is the same module imported by both — no duplication.

Production deployment paths:

- `position_estimator` and `rules_engine`: `supabase functions deploy <name>`.
- `mqtt_bridge`: deploy as a Docker image on Fly.io. Add a `Dockerfile` in `apps/edge/functions/mqtt_bridge/` when the long-running mode lands (Phase 1).

Service-role key handling: the long-running bridge holds it in its env. The edge functions get it from Supabase's runtime via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`. Never piped to clients.

**Scheduled jobs (pg_cron) and the fallback path**: Phase 4's inactivity rule type relies on a per-minute scheduled function. Primary path is `pg_cron`. If the chosen Supabase plan doesn't include it, the fallback is an external scheduler (Vercel Cron, GitHub Actions, Fly.io machines `[mounts.machines.schedule]`) hitting an HTTP-mode Edge Function with a bearer token from env. Document the chosen path in the relevant migration's PR description; both paths converge on the same `inactivity_scan` function code.

## 12. Migrations discipline

- **One logical change per migration**. Adding a table, adding a policy, modifying an enum — separate files.
- **Sequential timestamps**. Filename format `YYYYMMDDHHMMSS_<slug>.sql`. Use `supabase migration new <slug>` to generate.
- **Rollback note in PR**. If the migration adds a column or table, rollback is "drop". If it changes data, rollback is "manual" — and the PR description says so.
- **Edge function dependencies**. If a function depends on a schema change, deploy the migration first. The CI pipeline applies migrations before deploying functions; verify ordering when adding to `.github/workflows/`.

## 13. Testing strategy

| Layer                                          | Tool                                                | Target                                                                    |
| ---------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| Pure functions (utility math, rule evaluators) | Vitest                                              | 90%+ for `packages/shared/src/positioning/`, `packages/shared/src/rules/` |
| Components (critical UI flows)                 | React Testing Library + Vitest                      | login, roster, dashboard tabs, alert bell, ack flow                       |
| Realtime hooks                                 | Vitest with mocked Supabase client                  | `usePatientStream` cleanup, reconnect handling                            |
| Edge functions (HTTP entry)                    | Vitest in Node mode                                 | Each function's HTTP handler with seeded DB                               |
| Integration                                    | one full chain test against a seeded local Supabase | sensor-to-alert path end-to-end                                           |
| Manual                                         | device-in-the-loop in Week 5 (TST-14)               | UX walkthrough with non-team participant                                  |

Coverage gates: not enforced as percentages. Required-or-CI-fails: the parity test in §10, the RLS denial tests in `apps/web/src/test/rls.test.ts`, and the foundation smoke we already have.

## 14. Accessibility floor

WCAG AA on critical paths: login, roster, viewing a patient, acknowledging an alert. Specifically:

- **Color contrast**: all text on background passes AA. Brand palette tokens are designed for this; verify in Phase 5 with axe-core.
- **Keyboard navigation**: tab order is sensible; all interactive elements reachable; focus rings visible (don't `outline: none` without a replacement).
- **Screen reader**: live region (`aria-live="assertive"` for criticals, `polite` for warns/info) announces new alerts.
- **Form labels**: all inputs have associated labels (already true via `<Label htmlFor>` in shadcn primitives).

Canvas-based components (F5, F8 marker, F13 scrubber) get a parallel keyboard surface — described in F5/F8/F13 feature docs. Defer full screen-reader support for canvas to V2.

## 15. Brand consistency

The Tailwind config bakes the palette. The principle: don't reach past the tokens for colours. If a feature wants a new colour, it gets added to the token set and reviewed.

- Body type: Inter (already wired).
- Title type: Century Schoolbook italic via the `font-serif italic` class. The fallback chain handles systems without Century Schoolbook.
- Severity colour map: info = steel, warn = orange, critical = a defined red (added when F12 lands; pin in `globals.css`).
- Spacing rhythm: Tailwind defaults; don't introduce custom spacing.

## 16. Performance budgets

For the prototype:

| Surface                                   | Budget                      |
| ----------------------------------------- | --------------------------- |
| Initial JS bundle (gzipped)               | < 200 KB (currently ~97 KB) |
| Time to interactive (login page, slow 3G) | < 3 s                       |
| Realtime update render                    | < 100 ms                    |
| Floor plan canvas render (initial)        | < 500 ms                    |
| 24 h history page initial paint           | < 2 s                       |

Fabric.js and Mapbox each add ~100 KB gzipped — acceptable but watch the totals when they land. Lazy-load both per route (Vite supports this naturally with dynamic `import()`).

---

## When this doc and a feature spec disagree

This doc wins for cross-cutting concerns. The feature doc wins for feature-specific behaviour. If a conflict isn't resolvable that way, raise it in the next standup and update both docs in the same PR.
