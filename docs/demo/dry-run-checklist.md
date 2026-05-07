# DOC-11 — Dry-run checklist

Two dry runs must pass before the live demo. Each dry run covers this checklist in
full. Record the reviewer's name and outcome in the table at the bottom of this file.

Run the checklist in order. A failed item blocks the dry run — fix the issue before
proceeding.

---

## Stack

- [ ] Prod URL loads without a network error (`https://<prod-domain>/`).
- [ ] Hosted Supabase project is reachable: open the Supabase Studio URL and confirm
      the `sensor_readings` table has rows inserted within the last 10 minutes.
- [ ] Mosquitto broker is online, **or** the mock generator is producing seeded data
      into the hosted DB at the expected rate.
  - If the broker / generator is unavailable: confirm the demo patient has at least
    1 h of pre-seeded `position_estimates` and `sensor_readings` so the live-feed
    beat can still run off recent rows. Mark this item as "using seeded data —
    broker offline" rather than failing the dry run.
- [ ] Rules engine edge function is deployed and the Vault secrets
      `edge_functions_base_url` and `edge_functions_service_role_key` are set on the
      hosted project (see `BACKLOG.md` — F11 webhooks).

---

## Data {#data}

The following data must exist on the demo patient before the dry run begins.

- [ ] Demo patient row exists in the `patients` table and is allocated to
      `admin@bizzieapp.com`.
- [ ] `position_estimates`: ≥ 1 h of rows for the demo patient at ≈ 1 Hz. Verify
      with:
  ```sql
  select count(*), min(recorded_at), max(recorded_at)
  from position_estimates
  where patient_id = '<demo-patient-uuid>'
    and recorded_at > now() - interval '2 hours';
  ```
  Expected: `count ≥ 3600`.
- [ ] `sensor_readings`: ≥ 1 h of rows at ≈ 1 Hz. Same query shape as above.
- [ ] Alerts: ≥ 3 fired alerts for the demo patient, including at least 1 with
      `severity = 'critical'` and `acknowledged_at IS NULL`.
- [ ] Floor plan: at least 1 `floor_plans` row for the demo patient with
      non-null `canvas_json` and `scale_meters_per_pixel`.
- [ ] Beacons: ≥ 4 rows in `beacons` linked to the demo patient's floor plan, each
      with `x_canvas` and `y_canvas` populated.
- [ ] Calibration points: ≥ 5 rows in `calibration_points` linked to the demo
      patient's floor plan, each with non-null `ble_signature`.
- [ ] Alert rules: at least one enabled rule of each type — `vitals`, `zone`,
      `fall`, `inactivity` — for the demo patient.

If the seed data is missing, run the seed script at `supabase/seed.sql` against the
hosted project or insert rows manually via Studio before the dry run.

---

## Browser

- [ ] Chrome (latest stable). Incognito window to eliminate extensions and cached
      auth state.
- [ ] Zoom level: 100% (Cmd+0 to reset).
- [ ] Network throttling: off. Confirm in DevTools → Network → Throttle = "No
      throttling". Close DevTools after confirming.
- [ ] No other tabs on the same domain.
- [ ] Font size is not overridden by OS accessibility settings — confirm text renders
      at the designed size.

---

## Audio and screen

- [ ] Laptop fan is quiet (or presenter is near enough to the mic that fan noise is
      not distracting).
- [ ] Screen sharing is set to share the correct display at full resolution. Test
      resolution with the screen-share preview before the audience joins.
- [ ] Browser font size reads comfortably at the shared resolution. If legibility is
      marginal, set Chrome font size to Large (Settings → Appearance → Font size →
      Large) and re-confirm at 100% zoom.
- [ ] Alert bell sound is audible: trigger or simulate a critical alert in the demo
      patient's feed and confirm the Web Audio cue plays from the laptop speakers.
      Alternatively, ensure speakers are unmuted and at a reasonable volume.
- [ ] Critical alert notification: confirm the browser has granted notification
      permission for the prod domain (one-time prompt on first critical alert). If
      not granted, grant it manually in Chrome site settings.

---

## Backup tab {#backup-tab}

- [ ] A second Chrome incognito tab is open on the prod URL, already signed in as
      `admin@bizzieapp.com`, and sitting on the demo patient's History tab.
- [ ] The backup tab is positioned as Tab 2 in the window. Confirm you can reach
      it with a single Cmd+2 press.
- [ ] If the [backup video](./backup-video-plan.md) is the last resort, confirm the
      file exists at `docs/demo/assets/v1-demo-backup.mp4` and VLC (or QuickTime) can
      open it.

---

## Dry-run sessions

Two dry runs must be scheduled and completed before the live demo. Record the outcome
here.

| #   | Date | Reviewer(s) | Outcome     | Notes |
| --- | ---- | ----------- | ----------- | ----- |
| 1   |      |             | Pass / Fail |       |
| 2   |      |             | Pass / Fail |       |

A dry run passes if every checklist item is satisfied and the presenter completes the
[demo script](./script.md) without unrecovered failures. A "used seeded data" item
does not constitute a failure provided the fallback narration is rehearsed.

See also: [demo script](./script.md), [backup video plan](./backup-video-plan.md).
