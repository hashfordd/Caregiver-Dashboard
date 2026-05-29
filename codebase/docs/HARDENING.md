# Hardening — security, performance, reliability, features

Tracks the hardening pass against the review findings. Each item notes what
shipped in code vs. what still needs an out-of-band console/ops action that
can't be done from the repo.

## 1. Security

### SEC-01 — realtime signals channel authorization ✅ (code) / ⚠️ (hosted validation)

The `patient:<id>:signals` broadcast channel previously relied on topic
name-spacing alone — any authenticated caregiver could subscribe to any
patient's live telemetry. Now closed via Supabase Realtime Authorization:

- Migration `20260530000000_sec01_realtime_signals_authz.sql` adds an RLS
  `select` policy on `realtime.messages` scoping broadcast receipt by
  `can_access_patient(<topic-uuid>)`.
- The dashboard (`usePatientStream`) and the bridge (`processMessage`) open
  the channel as **private** (`{ config: { private: true } }`).
- The bridge calls `supabase.realtime.setAuth(SERVICE_ROLE_KEY)` so it can
  publish to the private channel (service*role bypasses realtime RLS); only
  client \_receipt* is gated.

**Must validate against a hosted project** (local `supabase functions serve`
doesn't run the bridge — see BACKLOG). After deploy:

1. As caregiver A (allocated to patient P), confirm live signals still flow.
2. As caregiver B (NOT allocated to P), confirm `supabase.channel('patient:P:signals',{config:{private:true}}).subscribe()` receives nothing.
3. Confirm the bridge logs no `broadcast-failed`.

### MQTT read-only broker credentials ⚠️ (HiveMQ console)

`VITE_MQTT_RO_USERNAME/PASSWORD` are shipped to the browser by design (the
browser connects directly to HiveMQ). Security rests on the HiveMQ ACL for
that user. **Action in the HiveMQ Cloud console:**

- Restrict the `dashboard-ro` credential to **subscribe-only** on the device
  topic space (e.g. `device/+/+` read; no publish, no `$SYS`).
- Confirm it cannot publish (so a leaked browser credential can't inject
  false telemetry).
- Future: mint short-lived per-session broker tokens server-side instead of
  shipping a shared static credential. Tracked as MQ-04/05.

### Supabase anon-key JWT expiry ⚠️ (Supabase dashboard)

The anon key is public by design (RLS is the boundary), but session JWT
lifetime should be tightened. **Action in the Supabase dashboard:**

- Authentication → Sessions: set **JWT expiry** to 3600s (1 hour).
- Ensure **refresh token rotation** is enabled (default on) so short access
  tokens are transparently refreshed.

### audit_log ✅ (already shipped)

Verified already implemented (migrations `20260507300000` + `20260508100200`):
triggers cover device pairing, rule changes, acknowledgements, patient notes,
invites, and role changes; `audit_log_admin_read` gives provider admins
tenant-scoped SELECT. No further work needed.

### RLS write policies ✅ (already shipped)

Verified per-table write surfaces exist (caregivers, patients,
caregiver_patient, devices, floor_plans, beacons, calibration_points,
alert_rules) plus `provider_admin_rls`. Time-series tables (sensor_readings,
position_estimates, alerts, events) are service-role-write-only by design.
The backlog's BE-04 "only read-scoping stubbed" note is stale.

### Invite token delivery ✅ (code)

Token moved from the URL **path** (`/invite/:token`) to the **fragment**
(`/invite#<token>`), so it no longer reaches server access logs or the
Referer header. Threaded through the `/login` bounce via router state + the
preserved hash (`AcceptInvitePage`, `LoginPage`, `App` route). DB-side
hardening (single-use, 7-day expiry, 50/hr rate limit, email match) was
already in place.

## 2. Performance & smoothness ✅

- **lastSeen re-render cascade** — `usePatientStream` now flushes `lastSeen`
  through a leading-edge throttle (first sample immediate, rest coalesced to
  ≤1 render/sec), collapsing the per-message context re-render storm.
- **LiveGridRow** — wrapped in `React.memo` with a comparator that skips
  ticks which don't change the row's visible status/relative-age label.
- **outdoorTrailStore** — 30-min trim is now a front-drop scan (array is
  time-ascending) instead of a full filter that re-parsed every timestamp on
  each 1 Hz push.
- **Vite chunking** — `manualChunks` splits mapbox-gl / fabric / recharts
  into their own cacheable chunks (route-level `React.lazy` already in place).

## 3. Reliability ✅ (code) / ⚠️ (deploy)

- **Reconnect never gives up** — `subscribeWithRetry` previously went silent
  after 6 attempts. It now backs off exponentially to a 30s cap and **keeps
  retrying forever**, reporting per-channel health into `realtimeHealthStore`.
- **LIVE DATA LOST banner** — `LiveDataLostBanner` (mounted in `AppLayout`)
  shows a loud, sticky, `role="alert"` banner with a repeating audible cue
  whenever any channel is offline, and clears itself on reconnect. The
  per-patient header pill also surfaces an `offline` state.
- **position_estimates retention** — migration `20260530010000` adds an
  hourly `pg_cron` compactor: full resolution < 7 days, downsampled to 1
  row/min for 7–90 days, deleted past 90 days. Tune the windows per
  deployment.
- **Bridge containerization** — `apps/edge/Dockerfile` + `apps/edge/fly.toml`
  ship the long-running bridge as a single always-on Fly machine. Deploy:
  `cd codebase && flyctl deploy --config apps/edge/fly.toml --dockerfile apps/edge/Dockerfile`,
  set secrets via `flyctl secrets set …`, and `flyctl scale count 1` (the
  bridge must run as exactly one instance — each broker message once).

## 4. Features ✅ / verified

- **°C / °F preference** ✅ — `caregivers.temperature_unit` column
  (`20260530020000`), profile toggle, app-wide unit store hydrated at the
  shell, applied in the history `VitalsChart` tooltip + legend.
- **SpO2 / temperature** ✅ verified — the live view (`LiveTab`) renders the
  HR card only and deliberately omits SpO2/temp (the wearable doesn't report
  them); no fake or misleading empty cards. `SensorCard` shows an honest
  "Awaiting first reading…" state when a metric has no data.
- **Backgrounded-alert delivery** ✅ verified — `AlertCueHost` → `useCriticalCue`
  fires a Web Audio tone + a desktop `Notification` (gated on `document.hidden`),
  so a critical isn't lost when the tab is backgrounded.
- **Signup role selection** ✅ verified — `SignupPage` already offers
  professional/family role selection (backlog "Auth signup flow" note stale).
- **repetitive_movement rule** — reserved enum value, intentionally **not**
  exposed in any rule picker (`RuleSettingsTab` renders only implemented
  cards; the history filter handles it with no chip). The evaluator stays
  deferred until the wearable feeds an IMU motion-pattern signal the data
  model can match — implementing it now would be dead code with no input.
- **npm audit** — reduced 16 → 9 via `npm audit fix --package-lock-only`
  (qs, ws, etc. patched). No critical/high remain (the scaffold's "1 critical
  - 3 high" are gone). The residual 9 (4 low / 5 moderate) are the dev-only
    `lint-staged → yaml` DoS chain, which needs `--force` to bump a pinned dev
    tool — deferred per the existing backlog guidance.

### Still V2 (larger UI features, not in this pass)

Documented as deferred in BACKLOG; each is a sizeable standalone feature:
peer-caregiver chips on the patient header (needs a broadened SELECT or RPC),
the on-canvas zone-polygon picker (F11/UI-22), and the F7 calibration
stale-banner + per-room density heatmap (F7/UI-08-10).
