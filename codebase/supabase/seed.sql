-- ============================================================================
-- Demo seed data — covers every feature surface in the codebase
-- ============================================================================
--
-- Run after the signed-in admin user (admin@bizzieapp.com by default) has
-- created their auth.users row via the LoginPage signup flow. This seed
-- looks the admin up by email, attaches them to a care_provider as
-- tenant admin, and populates a realistic mix of patients, devices,
-- floor plans, beacons, calibration captures, recent positions + vitals,
-- alert rules + fired alerts, and patient notes.
--
-- Idempotent: every insert uses `on conflict do nothing`. Re-running
-- keeps existing rows untouched and patches any missing pieces.
--
-- Override the admin email by editing the v_admin_email default below.
-- ============================================================================

do $seed$
declare
  v_admin_email      text := 'admin@bizzieapp.com';
  v_admin_id         uuid;
  v_provider_id      uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

  -- Patients
  v_eve_id           uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_frank_id         uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_grace_id         uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_henry_id         uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';

  -- Devices
  v_eve_device_id    uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
  v_frank_device_id  uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
  v_henry_device_id  uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc4';

  -- Floor plan + beacons (Eve's place)
  v_eve_plan_id      uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
  v_beacon1_id       uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
  v_beacon2_id       uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2';
  v_beacon3_id       uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3';
  v_beacon4_id       uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee4';

  -- Alert rule ids
  v_rule_eve_vitals  uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff1';
  v_rule_eve_zone    uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  v_rule_frank_zone  uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff3';
  v_rule_henry_fall  uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff4';

  v_now              timestamptz := now();
begin
  -- ──────────────────────────────────────────────────────────────────────
  -- 1. Resolve the admin auth user. Bail loudly if they haven't signed up.
  -- ──────────────────────────────────────────────────────────────────────
  select id into v_admin_id from auth.users where email = v_admin_email;
  if v_admin_id is null then
    raise exception
      'Seed: no auth user for %. Sign up via /signup with that email first, then re-run this seed.',
      v_admin_email;
  end if;

  -- ──────────────────────────────────────────────────────────────────────
  -- 2. Care provider + bind the admin as tenant admin.
  --
  -- Phase I.A migration 20260508100000 installed a BEFORE UPDATE trigger
  -- that blocks direct UPDATEs to caregivers.provider_role /
  -- care_provider_id outside the set_caregiver_role RPC. The documented
  -- bypass is the transaction-local setting `alzcare.role_change_authorized`.
  -- We set it here so the seed (running as superuser) can bind the
  -- admin without going through the RPC's auth.uid() path.
  -- ──────────────────────────────────────────────────────────────────────
  insert into public.care_providers (id, name)
       values (v_provider_id, 'Acme Care Co')
       on conflict (id) do nothing;

  perform set_config('alzcare.role_change_authorized', 'true', true);

  update public.caregivers
     set care_provider_id = v_provider_id,
         provider_role    = 'admin',
         company_name     = coalesce(company_name, 'Acme Care Co')
   where id = v_admin_id;

  -- ──────────────────────────────────────────────────────────────────────
  -- 3. Patients — varied stage + wandering-risk profiles.
  -- ──────────────────────────────────────────────────────────────────────
  insert into public.patients
    (id, full_name, dob, description, care_provider_id,
     dementia_stage, wandering_risk, known_triggers, care_plan_summary, preferences)
  values
    (v_eve_id,   'Eve Mitchell',  '1947-08-12',
     'Likes morning walks in the courtyard. Independent with dressing.',
     v_provider_id, 'early', 'low',
     ARRAY['loud noises', 'unfamiliar visitors'],
     'Eve is in the early stage and remains largely independent. Encourage her to do the daily crossword — she enjoys it and it anchors her routine. She prefers tea with a splash of milk at 10:00 and 15:00.',
     '{"meals":"low salt","mobility":"unaided","preferred_room":"sunroom"}'::jsonb),

    (v_frank_id, 'Frank O''Brien','1942-03-04',
     'Retired carpenter. Lives in a ground-floor unit with garden access.',
     v_provider_id, 'moderate', 'high',
     ARRAY['evening sundowning', 'crowded rooms', 'TV news'],
     'Frank wanders most evenings between 17:00 and 19:00 — please redirect rather than restrain. Familiar music (Irish folk) settles him. Has wandered into the carpark twice this month.',
     '{"music":"irish folk","meals":"soft food","mobility":"walker"}'::jsonb),

    (v_grace_id, 'Grace Park',    '1950-11-23',
     'Recently joined the program. Family checks in twice a week.',
     v_provider_id, 'early', 'medium',
     ARRAY['mornings before coffee'],
     'Grace is new to us — pairing pending. Establish baseline rhythms over the next fortnight before tightening alert thresholds.',
     '{}'::jsonb),

    (v_henry_id, 'Henry Wallace', '1941-06-18',
     'Former teacher. Limited mobility — uses a walker indoors.',
     v_provider_id, 'advanced', 'high',
     ARRAY['being rushed', 'sudden lights', 'cold rooms'],
     'Henry needs assistance with most ADLs. Risk of falls is high — keep walker within reach at all times. Family present every Sunday afternoon.',
     '{"mobility":"walker","fall_risk":"high","preferred_room":"library"}'::jsonb)
  on conflict (id) do nothing;

  -- Backfill care plan for any rows that already existed pre-Phase II.B —
  -- the migration defaults left them at 'unknown'/'low'/empty, but the
  -- demo wants something to look at.
  update public.patients p
     set dementia_stage    = v.new_stage,
         wandering_risk    = v.new_risk,
         known_triggers    = v.new_triggers,
         care_plan_summary = v.new_summary,
         preferences       = v.new_prefs
    from (values
      (v_eve_id,   'early',    'low',    ARRAY['loud noises','unfamiliar visitors']::text[],
       'Eve is in the early stage and remains largely independent.',
       '{"meals":"low salt","mobility":"unaided","preferred_room":"sunroom"}'::jsonb),
      (v_frank_id, 'moderate', 'high',   ARRAY['evening sundowning','crowded rooms','TV news']::text[],
       'Frank wanders most evenings between 17:00 and 19:00.',
       '{"music":"irish folk","meals":"soft food","mobility":"walker"}'::jsonb),
      (v_grace_id, 'early',    'medium', ARRAY['mornings before coffee']::text[],
       'Grace is new to us — pairing pending.',
       '{}'::jsonb),
      (v_henry_id, 'advanced', 'high',   ARRAY['being rushed','sudden lights','cold rooms']::text[],
       'Henry needs assistance with most ADLs.',
       '{"mobility":"walker","fall_risk":"high","preferred_room":"library"}'::jsonb)
    ) as v(pid, new_stage, new_risk, new_triggers, new_summary, new_prefs)
   where p.id = v.pid
     and p.dementia_stage = 'unknown';

  -- ──────────────────────────────────────────────────────────────────────
  -- 4. Allocate every patient to the admin.
  -- ──────────────────────────────────────────────────────────────────────
  insert into public.caregiver_patient (caregiver_id, patient_id)
       values
         (v_admin_id, v_eve_id),
         (v_admin_id, v_frank_id),
         (v_admin_id, v_grace_id),
         (v_admin_id, v_henry_id)
       on conflict (caregiver_id, patient_id) do nothing;

  -- ──────────────────────────────────────────────────────────────────────
  -- 5. Devices — Eve, Frank, Henry are paired. Grace is unpaired
  --    (her detail page demos the pairing flow).
  -- ──────────────────────────────────────────────────────────────────────
  insert into public.devices
    (id, mac_address, firmware_version, paired_patient_id, last_seen_at)
  values
    (v_eve_device_id,   'aa:bb:cc:00:00:01', '1.4.2', v_eve_id,   v_now - interval '4 seconds'),
    (v_frank_device_id, 'aa:bb:cc:00:00:02', '1.4.2', v_frank_id, v_now - interval '12 seconds'),
    (v_henry_device_id, 'aa:bb:cc:00:00:04', '1.3.9', v_henry_id, v_now - interval '4 minutes')
  on conflict (id) do nothing;

  -- ──────────────────────────────────────────────────────────────────────
  -- 6. Floor plan + beacons (Eve only — full F5/F6 demo).
  -- ──────────────────────────────────────────────────────────────────────
  insert into public.floor_plans
    (id, patient_id, name, canvas_json, scale_meters_per_pixel)
  values
    (v_eve_plan_id, v_eve_id, 'Ground floor',
     -- Minimal canvas: an outer rectangle + two interior walls so the
     -- floor-plan view has something to show. The PlaceTab editor lets
     -- the user iterate the geometry; this is just a starting frame.
     '{
        "version": "1.0",
        "objects": [
          {"type": "wall", "x1": 40, "y1": 40,  "x2": 760, "y2": 40},
          {"type": "wall", "x1": 760,"y1": 40,  "x2": 760, "y2": 520},
          {"type": "wall", "x1": 760,"y1": 520, "x2": 40,  "y2": 520},
          {"type": "wall", "x1": 40, "y1": 520, "x2": 40,  "y2": 40},
          {"type": "wall", "x1": 320,"y1": 40,  "x2": 320, "y2": 280},
          {"type": "wall", "x1": 320,"y1": 280, "x2": 760, "y2": 280}
        ]
      }'::jsonb,
     0.04)
  on conflict (id) do nothing;

  insert into public.beacons
    (id, patient_id, floor_plan_id, mac_address, x_canvas, y_canvas, label, tx_power, rssi_at_1m)
  values
    (v_beacon1_id, v_eve_id, v_eve_plan_id, 'b1:00:00:00:00:01', 120, 120, 'Sunroom',  -59, -65),
    (v_beacon2_id, v_eve_id, v_eve_plan_id, 'b1:00:00:00:00:02', 540, 160, 'Kitchen',  -59, -64),
    (v_beacon3_id, v_eve_id, v_eve_plan_id, 'b1:00:00:00:00:03', 200, 420, 'Bedroom',  -59, -66),
    (v_beacon4_id, v_eve_id, v_eve_plan_id, 'b1:00:00:00:00:04', 600, 420, 'Bathroom', -59, -65)
  on conflict (id) do nothing;

  -- ──────────────────────────────────────────────────────────────────────
  -- 7. Position estimates — recent enough for the dashboard live-grid
  --    to show online/stale/offline accurately.
  --      Eve   → online (last seen 4 s ago).
  --      Frank → online (last seen 12 s ago) but in a watched zone.
  --      Henry → stale (last seen 4 min ago).
  --      Grace → offline (no rows).
  --
  -- 60 rows per online patient gives Sparkline + History a meaningful
  -- backlog without over-seeding.
  -- ──────────────────────────────────────────────────────────────────────
  if not exists (select 1 from public.position_estimates where patient_id = v_eve_id) then
    insert into public.position_estimates
      (patient_id, recorded_at, mode, x_canvas, y_canvas, confidence)
    select
      v_eve_id,
      v_now - (i || ' seconds')::interval,
      'indoor'::public.position_mode,
      140 + (random() * 30)::numeric,
      150 + (random() * 30)::numeric,
      0.78 + random() * 0.1
    from generate_series(0, 60, 5) as t(i);
  end if;

  if not exists (select 1 from public.position_estimates where patient_id = v_frank_id) then
    insert into public.position_estimates
      (patient_id, recorded_at, mode, x_canvas, y_canvas, confidence)
    select
      v_frank_id,
      v_now - (i || ' seconds')::interval,
      'indoor'::public.position_mode,
      -- Frank drifts toward the carpark zone (high x, low y) over the
      -- last minute — drives the open zone alert below.
      case when i < 30 then 720 + (random() * 20)::numeric
           else 580 + (random() * 20)::numeric end,
      case when i < 30 then 80  + (random() * 20)::numeric
           else 200 + (random() * 20)::numeric end,
      0.72 + random() * 0.1
    from generate_series(0, 60, 5) as t(i);
  end if;

  if not exists (select 1 from public.position_estimates where patient_id = v_henry_id) then
    insert into public.position_estimates
      (patient_id, recorded_at, mode, x_canvas, y_canvas, confidence)
    values
      (v_henry_id, v_now - interval '4 minutes', 'indoor', 200, 420, 0.65);
  end if;

  -- ──────────────────────────────────────────────────────────────────────
  -- 8. Sensor readings — last 10 minutes of vitals for the two patients
  --    with paired devices that are online. Drives the Sparkline + the
  --    History tab vitals charts.
  -- ──────────────────────────────────────────────────────────────────────
  if not exists (select 1 from public.sensor_readings where patient_id = v_eve_id) then
    insert into public.sensor_readings
      (patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c)
    select
      v_eve_id,
      v_eve_device_id,
      v_now - (i || ' seconds')::interval,
      (72 + sin(i::numeric / 30) * 4 + (random() - 0.5) * 2)::numeric(5,1),
      (98 - random() * 1)::numeric(4,1),
      (36.6 + (random() - 0.5) * 0.2)::numeric(4,2)
    from generate_series(0, 600, 30) as t(i);
  end if;

  if not exists (select 1 from public.sensor_readings where patient_id = v_frank_id) then
    insert into public.sensor_readings
      (patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c)
    select
      v_frank_id,
      v_frank_device_id,
      v_now - (i || ' seconds')::interval,
      -- Frank's HR climbs as he wanders; demos the vitals-correlated alert.
      case when i < 60 then (105 + (random() - 0.5) * 6)::numeric(5,1)
           else (84 + (random() - 0.5) * 4)::numeric(5,1) end,
      (97 - random() * 1.5)::numeric(4,1),
      (36.8 + (random() - 0.5) * 0.2)::numeric(4,2)
    from generate_series(0, 600, 30) as t(i);
  end if;

  -- ──────────────────────────────────────────────────────────────────────
  -- 9. Alert rules — one per archetype so the rules-engine UI shows the
  --    full card mix.
  -- ──────────────────────────────────────────────────────────────────────
  insert into public.alert_rules
    (id, patient_id, type, params, severity, enabled)
  values
    (v_rule_eve_vitals, v_eve_id, 'vitals',
     '{"metric":"hr_bpm","min":50,"max":110,"window_seconds":120}'::jsonb,
     'warn', true),
    (v_rule_eve_zone, v_eve_id, 'zone',
     '{"polygon":[[300,260],[760,260],[760,520],[300,520]],"direction":"leave","label":"Bedroom only-between"}'::jsonb,
     'info', true),
    (v_rule_frank_zone, v_frank_id, 'zone',
     '{"polygon":[[640,40],[760,40],[760,160],[640,160]],"direction":"enter","label":"Restricted carpark zone"}'::jsonb,
     'critical', true),
    (v_rule_henry_fall, v_henry_id, 'fall',
     '{"sensitivity":"high"}'::jsonb,
     'critical', true)
  on conflict (id) do nothing;

  -- ──────────────────────────────────────────────────────────────────────
  -- 10. Fired alerts — a mix of unacked + acked at varied severities so
  --     the AlertBell badge counter, the grid's inline Ack, and the
  --     dashboard alert stream are all populated.
  -- ──────────────────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.alerts
     where patient_id in (v_eve_id, v_frank_id, v_henry_id)
  ) then
    insert into public.alerts
      (patient_id, rule_id, severity, fired_at, acknowledged_at, ack_by_caregiver_id, context)
    values
      -- Frank: just entered the restricted zone, unacked.
      (v_frank_id, v_rule_frank_zone, 'critical',
       v_now - interval '2 minutes', null, null,
       '{"kind":"zone","direction":"enter","label":"Restricted carpark zone"}'::jsonb),
      -- Henry: fall detected, unacked.
      (v_henry_id, v_rule_henry_fall, 'critical',
       v_now - interval '30 minutes', null, null,
       '{"kind":"fall","accel_peak_g":3.4}'::jsonb),
      -- Eve: HR breach earlier today, already acked.
      (v_eve_id, v_rule_eve_vitals, 'warn',
       v_now - interval '1 hour', v_now - interval '58 minutes', v_admin_id,
       '{"kind":"vitals","metric":"hr_bpm","value":118,"breached":"high"}'::jsonb),
      -- Eve: zone breach last night, acked.
      (v_eve_id, v_rule_eve_zone, 'info',
       v_now - interval '14 hours', v_now - interval '13 hours 50 minutes', v_admin_id,
       '{"kind":"zone","direction":"leave","label":"Bedroom only-between"}'::jsonb),
      -- Frank: earlier wander, acked.
      (v_frank_id, v_rule_frank_zone, 'critical',
       v_now - interval '6 hours', v_now - interval '5 hours 55 minutes', v_admin_id,
       '{"kind":"zone","direction":"enter","label":"Restricted carpark zone"}'::jsonb);
  end if;

  -- ──────────────────────────────────────────────────────────────────────
  -- 11. Patient notes — 1–2 per patient so the Notes tab is non-empty.
  -- ──────────────────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.patient_notes
     where patient_id in (v_eve_id, v_frank_id, v_grace_id, v_henry_id)
  ) then
    insert into public.patient_notes (patient_id, author_caregiver_id, body, created_at)
    values
      (v_eve_id,   v_admin_id, 'Completed crossword with Eve at 10:30. Mood bright. Asked about her granddaughter twice.', v_now - interval '4 hours'),
      (v_eve_id,   v_admin_id, 'Eve napped 13:00–14:15. No agitation. Took 200 mL of fluid post-nap.', v_now - interval '90 minutes'),
      (v_frank_id, v_admin_id, 'Frank attempted to leave through the side door 17:42. Redirected with Irish folk playlist; settled within 10 min.', v_now - interval '8 hours'),
      (v_frank_id, v_admin_id, 'Increased agitation around the 18:00 news bulletin. Switched TV off — visibly relaxed within 5 min.', v_now - interval '7 hours'),
      (v_grace_id, v_admin_id, 'Grace settled in well. Family rang at 11:00; conversation went smoothly. Pairing scheduled for tomorrow.', v_now - interval '20 hours'),
      (v_henry_id, v_admin_id, 'Henry tripped at the library threshold 06:42 — broke fall with walker. No apparent injury but observation continues.', v_now - interval '50 minutes');
  end if;

  -- ──────────────────────────────────────────────────────────────────────
  -- 12. Incidents (Phase II.C) — caregiver-logged events distinct from
  --     rule-fired alerts.
  -- ──────────────────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.incidents
     where patient_id in (v_eve_id, v_frank_id, v_grace_id, v_henry_id)
  ) then
    insert into public.incidents
      (patient_id, logged_by, occurred_at, type, severity, description,
       follow_up_required, resolved_at)
    values
      (v_henry_id, v_admin_id, v_now - interval '50 minutes', 'fall', 2,
       'Henry tripped at the library threshold but caught himself with the walker. Skin intact, no swelling on observation. Continuing to monitor.',
       true, null),
      (v_frank_id, v_admin_id, v_now - interval '7 hours', 'agitation', 2,
       'Increased agitation around the 18:00 news bulletin. Verbally redirecting Frank away from the lounge and switching to Irish folk playlist settled him within 5 minutes.',
       false, v_now - interval '6 hours 30 minutes'),
      (v_frank_id, v_admin_id, v_now - interval '8 hours', 'wander', 3,
       'Frank attempted to leave through the side door at 17:42. Redirected. Noted he reaches for the door whenever the news is on the TV — possible trigger.',
       true, null),
      (v_eve_id,   v_admin_id, v_now - interval '3 days', 'refusal', 1,
       'Eve declined her morning medication. Offered tea + chat first; took meds 20 minutes later without complaint.',
       false, v_now - interval '3 days' + interval '30 minutes');
  end if;

  -- ──────────────────────────────────────────────────────────────────────
  -- 13. Medications (Phase II.C) — admin-set prescription list with
  --     a few logged administrations for realism.
  -- ──────────────────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.medications
     where patient_id in (v_eve_id, v_frank_id, v_grace_id, v_henry_id)
  ) then
    insert into public.medications
      (id, patient_id, name, dose, route, schedule, prn, active, notes)
    values
      ('99999999-9999-9999-9999-999999999991', v_eve_id,
       'Donepezil', '5 mg', 'oral',
       '{"times":["08:00"],"tz":"Australia/Sydney"}'::jsonb, false, true,
       'Cognitive support — give with breakfast.'),
      ('99999999-9999-9999-9999-999999999992', v_eve_id,
       'Paracetamol', '500 mg', 'oral',
       null, true, true,
       'PRN for joint pain. Max 4 doses / 24 h.'),
      ('99999999-9999-9999-9999-999999999993', v_frank_id,
       'Memantine', '10 mg', 'oral',
       '{"times":["08:00","20:00"],"tz":"Australia/Sydney"}'::jsonb, false, true,
       'Crush and mix with applesauce — Frank dislikes pills whole.'),
      ('99999999-9999-9999-9999-999999999994', v_frank_id,
       'Quetiapine', '25 mg', 'oral',
       '{"times":["20:00"],"tz":"Australia/Sydney"}'::jsonb, false, true,
       'Evening dose — supports the sundowning window.'),
      ('99999999-9999-9999-9999-999999999995', v_henry_id,
       'Levothyroxine', '50 mcg', 'oral',
       '{"times":["07:00"],"tz":"Australia/Sydney"}'::jsonb, false, true,
       'Empty stomach, 30 min before breakfast.'),
      ('99999999-9999-9999-9999-999999999996', v_henry_id,
       'Atorvastatin', '20 mg', 'oral',
       '{"times":["20:00"],"tz":"Australia/Sydney"}'::jsonb, false, true,
       'Evening dose with food.')
    on conflict (id) do nothing;

    insert into public.medication_administrations
      (medication_id, scheduled_for, administered_at, administered_by, status, notes)
    values
      ('99999999-9999-9999-9999-999999999991',
       date_trunc('day', v_now) + interval '8 hours',
       date_trunc('day', v_now) + interval '8 hours 7 minutes',
       v_admin_id, 'given', null),
      ('99999999-9999-9999-9999-999999999993',
       date_trunc('day', v_now) + interval '8 hours',
       date_trunc('day', v_now) + interval '8 hours 12 minutes',
       v_admin_id, 'given', 'Crushed in applesauce, taken without resistance.'),
      ('99999999-9999-9999-9999-999999999995',
       date_trunc('day', v_now) + interval '7 hours',
       date_trunc('day', v_now) + interval '7 hours 5 minutes',
       v_admin_id, 'given', null),
      -- An earlier refusal so the audit trail isn't 100% green.
      ('99999999-9999-9999-9999-999999999991',
       date_trunc('day', v_now) - interval '2 days' + interval '8 hours',
       null,
       v_admin_id, 'refused',
       'Eve declined initially. Tried again 20 min later — accepted.');
  end if;

  raise notice 'Seed: bound % to provider %; inserted patients/devices/positions/alerts/notes/incidents/medications.',
    v_admin_email, v_provider_id;
end
$seed$;

-- ============================================================================
-- Phase II demo richness — extra blocks to exercise every surface
-- ============================================================================
--
-- The blocks above seed the bare minimum to load the dashboard. The
-- blocks below add the depth needed to test the new Phase II features
-- end-to-end — multi-caregiver tenant, 12h of historical telemetry for
-- the History tab, varied alerts so the avg-ack KPI is meaningful,
-- more activity so the feed fills past 30 entries, and calibration
-- captures so the Calibration tab has something to render.
--
-- Each block is independently re-runnable. Demo caregivers and extra
-- rows use deterministic UUIDs guarded by `if not exists` / `on
-- conflict do nothing`, so re-running this file is safe.
--
-- DEMO CAREGIVERS (password: demo1234!)
--   anna+demo@bizzieapp.com    member  · allocated to Eve + Grace
--   priya+demo@bizzieapp.com   member  · allocated to Frank + Henry
--   marcus+demo@bizzieapp.com  admin   · sees the whole tenant
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- Member caregivers — auth.users + handle_new_user trigger creates the
-- public.caregivers row, then we bind tenant + role through the
-- alzcare.role_change_authorized bypass.
-- ─────────────────────────────────────────────────────────────────────
do $members$
declare
  v_provider_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_anna_id     uuid := '12121212-1212-1212-1212-121212121212';
  v_priya_id    uuid := '13131313-1313-1313-1313-131313131313';
  v_marcus_id   uuid := '14141414-1414-1414-1414-141414141414';
  v_eve_id      uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_frank_id    uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_grace_id    uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_henry_id    uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
begin
  -- Anna Lee
  if not exists (select 1 from auth.users where id = v_anna_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_anna_id,
      'authenticated', 'authenticated',
      'anna+demo@bizzieapp.com',
      crypt('demo1234!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Anna Lee","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Priya Singh
  if not exists (select 1 from auth.users where id = v_priya_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_priya_id,
      'authenticated', 'authenticated',
      'priya+demo@bizzieapp.com',
      crypt('demo1234!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Priya Singh","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Marcus Chen (second admin so the demote-last-admin guard doesn't
  -- block role testing)
  if not exists (select 1 from auth.users where id = v_marcus_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_marcus_id,
      'authenticated', 'authenticated',
      'marcus+demo@bizzieapp.com',
      crypt('demo1234!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Marcus Chen","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Bind role + tenant via the documented session-var bypass for the
  -- caregivers_block_privileged_self_update trigger.
  perform set_config('alzcare.role_change_authorized', 'true', true);

  update public.caregivers
     set care_provider_id = v_provider_id,
         provider_role    = case when id = v_marcus_id
                                  then 'admin'::public.caregiver_provider_role
                                 else 'member'::public.caregiver_provider_role end,
         company_name     = coalesce(company_name, 'Acme Care Co')
   where id in (v_anna_id, v_priya_id, v_marcus_id);

  -- Anna covers Eve + Grace; Priya covers Frank + Henry; Marcus is an
  -- admin so the dashboard already shows him every patient via
  -- can_access_patient — we still allocate explicitly so caregiver_patient
  -- has a row (drives the Caregivers tab on each patient).
  insert into public.caregiver_patient (caregiver_id, patient_id) values
    (v_anna_id,   v_eve_id),
    (v_anna_id,   v_grace_id),
    (v_priya_id,  v_frank_id),
    (v_priya_id,  v_henry_id),
    (v_marcus_id, v_eve_id),
    (v_marcus_id, v_frank_id),
    (v_marcus_id, v_grace_id),
    (v_marcus_id, v_henry_id)
  on conflict (caregiver_id, patient_id) do nothing;

  raise notice 'Demo members: anna / priya / marcus seeded (password demo1234!).';
end
$members$;

-- ─────────────────────────────────────────────────────────────────────
-- 12h of historical telemetry — gives the History tab a meaningful
-- replay window and the vitals charts a populated x-axis. 10-minute
-- intervals strike a balance between visible motion and insert volume.
-- ─────────────────────────────────────────────────────────────────────
do $history$
declare
  v_eve_id          uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_frank_id        uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_henry_id        uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
  v_eve_device_id   uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
  v_frank_device_id uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
  v_henry_device_id uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc4';
  v_now             timestamptz := now();
  v_oldest          timestamptz := now() - interval '12 hours';
begin
  -- Skip if any patient already has rows >= 6h old (signals that the
  -- backfill ran on a previous invocation).
  if not exists (
    select 1 from public.position_estimates
     where patient_id = v_eve_id
       and recorded_at < now() - interval '6 hours'
  ) then
    -- Eve drifts within the lounge (x ~140-180, y ~150-180)
    insert into public.position_estimates
      (patient_id, recorded_at, mode, x_canvas, y_canvas, confidence)
    select
      v_eve_id,
      v_oldest + (i * interval '10 minutes'),
      'indoor'::public.position_mode,
      150 + (random() * 40)::numeric,
      155 + (random() * 35)::numeric,
      0.74 + random() * 0.12
    from generate_series(0, 71) as t(i);

    -- Frank's room (x ~580-640) with a sundowning excursion toward the
    -- carpark zone in the late afternoon (interval index ~50-58)
    insert into public.position_estimates
      (patient_id, recorded_at, mode, x_canvas, y_canvas, confidence)
    select
      v_frank_id,
      v_oldest + (i * interval '10 minutes'),
      'indoor'::public.position_mode,
      case when i between 50 and 58 then 700 + (random() * 50)::numeric
           else 590 + (random() * 50)::numeric end,
      case when i between 50 and 58 then 90  + (random() * 30)::numeric
           else 200 + (random() * 30)::numeric end,
      0.70 + random() * 0.12
    from generate_series(0, 71) as t(i);

    -- Henry — mostly resting in the library, a few walks
    insert into public.position_estimates
      (patient_id, recorded_at, mode, x_canvas, y_canvas, confidence)
    select
      v_henry_id,
      v_oldest + (i * interval '10 minutes'),
      'indoor'::public.position_mode,
      200 + (random() * 30)::numeric,
      420 + (random() * 30)::numeric,
      0.66 + random() * 0.10
    from generate_series(0, 71) as t(i);

    -- Vitals — Eve and Frank only (devices paired). Frank's HR climbs
    -- during his sundowning window so the vitals trace correlates with
    -- the alerts he triggers.
    insert into public.sensor_readings
      (patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c)
    select
      v_eve_id, v_eve_device_id,
      v_oldest + (i * interval '10 minutes'),
      (72 + sin(i::numeric / 6) * 5 + (random() - 0.5) * 2)::numeric(5,1),
      (98 - random() * 1)::numeric(4,1),
      (36.6 + (random() - 0.5) * 0.2)::numeric(4,2)
    from generate_series(0, 71) as t(i);

    insert into public.sensor_readings
      (patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c)
    select
      v_frank_id, v_frank_device_id,
      v_oldest + (i * interval '10 minutes'),
      case when i between 50 and 58
           then (108 + (random() - 0.5) * 6)::numeric(5,1)
           else (84 + (random() - 0.5) * 5)::numeric(5,1) end,
      (97 - random() * 1.5)::numeric(4,1),
      (36.8 + (random() - 0.5) * 0.2)::numeric(4,2)
    from generate_series(0, 71) as t(i);

    insert into public.sensor_readings
      (patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c)
    select
      v_henry_id, v_henry_device_id,
      v_oldest + (i * interval '10 minutes'),
      (68 + sin(i::numeric / 8) * 3 + (random() - 0.5) * 2)::numeric(5,1),
      (96 - random() * 1.5)::numeric(4,1),
      (36.5 + (random() - 0.5) * 0.2)::numeric(4,2)
    from generate_series(0, 71) as t(i);

    raise notice 'History: 12h of position + vitals seeded for Eve, Frank, Henry.';
  else
    raise notice 'History: skipped (existing data older than 6h found).';
  end if;
end
$history$;

-- ─────────────────────────────────────────────────────────────────────
-- Calibration captures — 6 points around Eve's floor plan with mock
-- BLE signatures so the Calibration tab shows real captures rather
-- than the empty state.
-- ─────────────────────────────────────────────────────────────────────
do $calibration$
declare
  v_eve_plan_id uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
begin
  if not exists (select 1 from public.calibration_points where floor_plan_id = v_eve_plan_id) then
    insert into public.calibration_points
      (id, floor_plan_id, x_canvas, y_canvas, ble_signature, captured_at)
    values
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'cal-1'),
       v_eve_plan_id, 130, 130,
       '[{"mac":"b1:00:00:00:00:01","rssi":-58,"samples":18},
         {"mac":"b1:00:00:00:00:02","rssi":-78,"samples":17},
         {"mac":"b1:00:00:00:00:03","rssi":-82,"samples":16}]'::jsonb,
       now() - interval '5 days'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'cal-2'),
       v_eve_plan_id, 540, 170,
       '[{"mac":"b1:00:00:00:00:01","rssi":-79,"samples":17},
         {"mac":"b1:00:00:00:00:02","rssi":-57,"samples":18},
         {"mac":"b1:00:00:00:00:04","rssi":-81,"samples":15}]'::jsonb,
       now() - interval '5 days' + interval '20 minutes'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'cal-3'),
       v_eve_plan_id, 200, 420,
       '[{"mac":"b1:00:00:00:00:03","rssi":-58,"samples":18},
         {"mac":"b1:00:00:00:00:01","rssi":-80,"samples":15},
         {"mac":"b1:00:00:00:00:04","rssi":-77,"samples":17}]'::jsonb,
       now() - interval '5 days' + interval '40 minutes'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'cal-4'),
       v_eve_plan_id, 600, 420,
       '[{"mac":"b1:00:00:00:00:04","rssi":-58,"samples":18},
         {"mac":"b1:00:00:00:00:02","rssi":-78,"samples":16},
         {"mac":"b1:00:00:00:00:03","rssi":-79,"samples":17}]'::jsonb,
       now() - interval '5 days' + interval '60 minutes'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'cal-5'),
       v_eve_plan_id, 380, 280,
       '[{"mac":"b1:00:00:00:00:01","rssi":-72,"samples":17},
         {"mac":"b1:00:00:00:00:02","rssi":-72,"samples":17},
         {"mac":"b1:00:00:00:00:03","rssi":-72,"samples":17},
         {"mac":"b1:00:00:00:00:04","rssi":-72,"samples":17}]'::jsonb,
       now() - interval '4 days'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'cal-6'),
       v_eve_plan_id, 400, 480,
       '[{"mac":"b1:00:00:00:00:03","rssi":-66,"samples":18},
         {"mac":"b1:00:00:00:00:04","rssi":-67,"samples":17},
         {"mac":"b1:00:00:00:00:01","rssi":-83,"samples":16}]'::jsonb,
       now() - interval '4 days' + interval '15 minutes');

    raise notice 'Calibration: 6 captures seeded for Eve''s floor plan.';
  end if;
end
$calibration$;

-- ─────────────────────────────────────────────────────────────────────
-- More alerts — 10 historical alerts with varied severities + ack
-- deltas so the avg_ack_minutes_7d KPI on the provider Overview is
-- meaningful, and so the alert stream + bell badge counts have depth.
-- ─────────────────────────────────────────────────────────────────────
do $more_alerts$
declare
  v_admin_id        uuid;
  v_anna_id         uuid := '12121212-1212-1212-1212-121212121212';
  v_priya_id        uuid := '13131313-1313-1313-1313-131313131313';
  v_marcus_id       uuid := '14141414-1414-1414-1414-141414141414';
  v_eve_id          uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_frank_id        uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_henry_id        uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
  v_rule_eve_vitals uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff1';
  v_rule_eve_zone   uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  v_rule_frank_zone uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff3';
  v_rule_henry_fall uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff4';
begin
  select id into v_admin_id from auth.users where email = 'admin@bizzieapp.com';
  if v_admin_id is null then
    raise notice 'more_alerts: skipping — admin user not found.';
    return;
  end if;

  -- Already at least 12 alerts? Skip.
  if (select count(*) from public.alerts
       where patient_id in (v_eve_id, v_frank_id, v_henry_id)) >= 12 then
    raise notice 'more_alerts: skipped (>=12 alerts already present).';
    return;
  end if;

  insert into public.alerts
    (id, patient_id, rule_id, severity, fired_at, acknowledged_at,
     ack_by_caregiver_id, context)
  values
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-1'),
     v_eve_id, v_rule_eve_vitals, 'warn',
     now() - interval '6 days' + interval '08:30',
     now() - interval '6 days' + interval '08:34', v_anna_id,
     '{"kind":"vitals","metric":"hr_bpm","value":115,"breached":"high"}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-2'),
     v_frank_id, v_rule_frank_zone, 'critical',
     now() - interval '5 days' + interval '17:15',
     now() - interval '5 days' + interval '17:17', v_priya_id,
     '{"kind":"zone","direction":"enter","label":"Restricted carpark zone"}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-3'),
     v_henry_id, v_rule_henry_fall, 'critical',
     now() - interval '4 days' + interval '03:42',
     now() - interval '4 days' + interval '03:48', v_priya_id,
     '{"kind":"fall","accel_peak_g":2.9}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-4'),
     v_eve_id, v_rule_eve_zone, 'info',
     now() - interval '3 days' + interval '23:50',
     now() - interval '3 days' + interval '23:58', v_admin_id,
     '{"kind":"zone","direction":"leave","label":"Bedroom only-between"}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-5'),
     v_frank_id, v_rule_frank_zone, 'warn',
     now() - interval '3 days' + interval '18:20',
     now() - interval '3 days' + interval '18:22', v_marcus_id,
     '{"kind":"zone","direction":"enter","label":"Restricted carpark zone"}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-6'),
     v_eve_id, v_rule_eve_vitals, 'warn',
     now() - interval '2 days' + interval '11:10',
     now() - interval '2 days' + interval '11:13', v_anna_id,
     '{"kind":"vitals","metric":"hr_bpm","value":112,"breached":"high"}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-7'),
     v_henry_id, v_rule_henry_fall, 'warn',
     now() - interval '2 days' + interval '06:42',
     now() - interval '2 days' + interval '06:50', v_priya_id,
     '{"kind":"fall","accel_peak_g":2.4}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-8'),
     v_frank_id, v_rule_frank_zone, 'critical',
     now() - interval '1 day' + interval '17:42',
     now() - interval '1 day' + interval '17:44', v_admin_id,
     '{"kind":"zone","direction":"enter","label":"Restricted carpark zone"}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-9'),
     v_eve_id, v_rule_eve_zone, 'info',
     now() - interval '1 day' + interval '23:10',
     now() - interval '1 day' + interval '23:24', v_anna_id,
     '{"kind":"zone","direction":"leave","label":"Bedroom only-between"}'::jsonb),
    (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'alert-10'),
     v_henry_id, v_rule_henry_fall, 'warn',
     now() - interval '12 hours',
     now() - interval '12 hours' + interval '7 minutes', v_priya_id,
     '{"kind":"fall","accel_peak_g":2.1}'::jsonb)
  on conflict (id) do nothing;

  raise notice 'Alerts: 10 historical alerts seeded across 7 days.';
end
$more_alerts$;

-- ─────────────────────────────────────────────────────────────────────
-- More activity — incidents, dose administrations, and notes from the
-- new member caregivers so the activity feed fills past 30 entries
-- and the audit log shows a multi-actor history.
-- ─────────────────────────────────────────────────────────────────────
do $more_activity$
declare
  v_admin_id     uuid;
  v_anna_id      uuid := '12121212-1212-1212-1212-121212121212';
  v_priya_id     uuid := '13131313-1313-1313-1313-131313131313';
  v_marcus_id    uuid := '14141414-1414-1414-1414-141414141414';
  v_eve_id       uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_frank_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_grace_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_henry_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
  v_med_done     uuid := '99999999-9999-9999-9999-999999999991'; -- Donepezil
  v_med_para     uuid := '99999999-9999-9999-9999-999999999992'; -- Paracetamol PRN
  v_med_mema     uuid := '99999999-9999-9999-9999-999999999993'; -- Memantine
  v_med_quet     uuid := '99999999-9999-9999-9999-999999999994'; -- Quetiapine
  v_med_levo     uuid := '99999999-9999-9999-9999-999999999995'; -- Levothyroxine
  v_med_atorv    uuid := '99999999-9999-9999-9999-999999999996'; -- Atorvastatin
begin
  select id into v_admin_id from auth.users where email = 'admin@bizzieapp.com';
  if v_admin_id is null then
    raise notice 'more_activity: skipping — admin user not found.';
    return;
  end if;

  -- Extra incidents (8 across 7 days, varied authors).
  insert into public.incidents
    (id, patient_id, logged_by, occurred_at, type, severity, description,
     follow_up_required, resolved_at)
  values
    (uuid_generate_v5('a1000000-0000-0000-0000-000000000000'::uuid, 'i-1'),
     v_eve_id, v_anna_id, now() - interval '6 days' + interval '14:20',
     'agitation', 1, 'Eve briefly anxious before the family video call. Settled with familiar music within 2 minutes.',
     false, now() - interval '6 days' + interval '14:30'),
    (uuid_generate_v5('a1000000-0000-0000-0000-000000000000'::uuid, 'i-2'),
     v_grace_id, v_anna_id, now() - interval '5 days' + interval '11:00',
     'refusal', 1, 'Declined morning coffee — said it tasted "wrong". Switched to tea, no further refusal.',
     false, now() - interval '5 days' + interval '11:05'),
    (uuid_generate_v5('a1000000-0000-0000-0000-000000000000'::uuid, 'i-3'),
     v_frank_id, v_priya_id, now() - interval '4 days' + interval '17:30',
     'wander', 2, 'Frank tried the side door at 17:30 — door alarm sounded. Redirected with promise of supper. Door alarm reset.',
     true, null),
    (uuid_generate_v5('a1000000-0000-0000-0000-000000000000'::uuid, 'i-4'),
     v_henry_id, v_priya_id, now() - interval '3 days' + interval '06:15',
     'fall', 2, 'Henry slipped on a damp patch in the en-suite. No injury, walker was within reach. Floor mopped + dried.',
     false, now() - interval '3 days' + interval '06:45'),
    (uuid_generate_v5('a1000000-0000-0000-0000-000000000000'::uuid, 'i-5'),
     v_eve_id, v_marcus_id, now() - interval '2 days' + interval '15:30',
     'medication_event', 1, 'Eve handed her donepezil to a visiting bird. Recovered before ingestion. Re-dosed 5 minutes later.',
     false, now() - interval '2 days' + interval '15:32'),
    (uuid_generate_v5('a1000000-0000-0000-0000-000000000000'::uuid, 'i-6'),
     v_grace_id, v_marcus_id, now() - interval '2 days' + interval '20:00',
     'other', 1, 'Grace recognised her grandson Theo by name during the evening visit — first time in 3 weeks.',
     false, now() - interval '2 days' + interval '20:01'),
    (uuid_generate_v5('a1000000-0000-0000-0000-000000000000'::uuid, 'i-7'),
     v_frank_id, v_anna_id, now() - interval '1 day' + interval '18:10',
     'agitation', 3, 'Severe sundowning episode — Frank shouted at the TV news and threw the remote. De-escalated by switching to Irish folk + dimming the lights. Took 25 minutes to settle.',
     true, null),
    (uuid_generate_v5('a1000000-0000-0000-0000-000000000000'::uuid, 'i-8'),
     v_henry_id, v_marcus_id, now() - interval '20 hours',
     'refusal', 2, 'Henry declined morning levothyroxine. Reattempted 30 minutes later — accepted with applesauce.',
     false, now() - interval '19 hours')
  on conflict (id) do nothing;

  -- Extra administrations (12 across the last 3 days, varied actors +
  -- statuses so the meds tab + activity feed show realism).
  insert into public.medication_administrations
    (id, medication_id, scheduled_for, administered_at, administered_by, status, notes)
  values
    -- 3 days ago morning
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-1'),
     v_med_done, now() - interval '3 days' + interval '08:00',
     now() - interval '3 days' + interval '08:05', v_anna_id, 'given', null),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-2'),
     v_med_mema, now() - interval '3 days' + interval '08:00',
     now() - interval '3 days' + interval '08:08', v_priya_id, 'given',
     'Crushed in applesauce.'),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-3'),
     v_med_levo, now() - interval '3 days' + interval '07:00',
     now() - interval '3 days' + interval '07:04', v_priya_id, 'given', null),
    -- 2 days ago evening
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-4'),
     v_med_quet, now() - interval '2 days' + interval '20:00',
     now() - interval '2 days' + interval '20:11', v_priya_id, 'given',
     'Held in the cheek — confirmed swallowed by 20:14.'),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-5'),
     v_med_atorv, now() - interval '2 days' + interval '20:00',
     now() - interval '2 days' + interval '20:09', v_anna_id, 'given', null),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-6'),
     v_med_para, null,
     now() - interval '2 days' + interval '14:10', v_marcus_id, 'given',
     'PRN dose for joint pain — settled within 30 min.'),
    -- yesterday
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-7'),
     v_med_done, now() - interval '1 day' + interval '08:00',
     null, v_anna_id, 'refused',
     'Eve refused — offered crossword first; will retry at 09:00.'),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-8'),
     v_med_done, now() - interval '1 day' + interval '09:00',
     now() - interval '1 day' + interval '09:08', v_anna_id, 'given',
     'Retry after morning crossword — accepted without complaint.'),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-9'),
     v_med_mema, now() - interval '1 day' + interval '20:00',
     now() - interval '1 day' + interval '20:12', v_priya_id, 'given', null),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-10'),
     v_med_levo, now() - interval '1 day' + interval '07:00',
     null, v_marcus_id, 'missed',
     'Henry was already eating breakfast — empty-stomach window missed. Withhold today, resume tomorrow per care plan.'),
    -- today extra
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-11'),
     v_med_atorv, date_trunc('day', now()) + interval '20:00',
     null, v_admin_id, 'skipped',
     'Patient asleep at scheduled time — clinical agreement to skip rather than wake.'),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'adm-12'),
     v_med_para, null,
     now() - interval '3 hours', v_anna_id, 'given',
     'PRN — Eve mentioned shoulder discomfort post-walk.')
  on conflict (id) do nothing;

  -- Extra notes (8 across 5 days, varied authors).
  insert into public.patient_notes
    (id, patient_id, author_caregiver_id, body, created_at)
  values
    (uuid_generate_v5('a3000000-0000-0000-0000-000000000000'::uuid, 'n-1'),
     v_eve_id, v_anna_id,
     'Eve had a particularly bright morning — completed the crossword in 12 minutes (usual: 18-20). Ate full breakfast.',
     now() - interval '5 days' + interval '10:30'),
    (uuid_generate_v5('a3000000-0000-0000-0000-000000000000'::uuid, 'n-2'),
     v_frank_id, v_priya_id,
     'Family visit went well. Frank recognised his daughter Maeve immediately. They walked the courtyard together for 25 minutes.',
     now() - interval '4 days' + interval '15:00'),
    (uuid_generate_v5('a3000000-0000-0000-0000-000000000000'::uuid, 'n-3'),
     v_grace_id, v_anna_id,
     'Grace asked if she could move the armchair closer to the window. Done — she spent 2 hours quietly reading after.',
     now() - interval '4 days' + interval '11:00'),
    (uuid_generate_v5('a3000000-0000-0000-0000-000000000000'::uuid, 'n-4'),
     v_henry_id, v_marcus_id,
     'Henry''s walker has a loose left wheel — flagged maintenance. Replacement walker delivered same day from stores.',
     now() - interval '3 days' + interval '14:30'),
    (uuid_generate_v5('a3000000-0000-0000-0000-000000000000'::uuid, 'n-5'),
     v_frank_id, v_anna_id,
     'Frank refused dinner around 19:00 — picked at the protein but ate the dessert. Followed up with a banana at 21:00.',
     now() - interval '2 days' + interval '21:30'),
    (uuid_generate_v5('a3000000-0000-0000-0000-000000000000'::uuid, 'n-6'),
     v_eve_id, v_priya_id,
     'Eve mentioned shoulder pain on her right side after the morning walk. Range of motion looks normal. Para PRN given. Will reassess in the morning.',
     now() - interval '1 day' + interval '12:00'),
    (uuid_generate_v5('a3000000-0000-0000-0000-000000000000'::uuid, 'n-7'),
     v_henry_id, v_priya_id,
     'Henry slept through the night without waking — first uninterrupted night since he arrived. Mood bright at breakfast.',
     now() - interval '1 day' + interval '07:30'),
    (uuid_generate_v5('a3000000-0000-0000-0000-000000000000'::uuid, 'n-8'),
     v_grace_id, v_marcus_id,
     'Grace pairing scheduled for tomorrow at 10:00. Family briefed; they''ll bring her favourite framed photo to put on the wearable charging dock.',
     now() - interval '6 hours')
  on conflict (id) do nothing;

  raise notice 'Activity: 8 incidents + 12 administrations + 8 notes seeded across the team.';
end
$more_activity$;

-- ============================================================================
-- All-tabs richness — fills the gaps so every patient tab has content
-- ============================================================================
--
-- Gap matrix before this section (✓ has, ✗ missing):
--                  Live  Place  Calib  Hist  Alerts  Meds  Rules
--   Eve              ✓    ✓      ✓     ✓     ✓       ✓     ✓
--   Frank            ✓    ✗      ✗     ✓     ✓       ✓     ✓
--   Grace            ✗    ✗      ✗     ✗     ✗       ✗     ✗
--   Henry            ✓    ✗      ✗     ✓     ✓       ✓     ✓
--
-- The blocks below close those ✗s. Idempotent — deterministic UUIDs +
-- if-not-exists guards.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- Floor plans + beacons for Frank, Grace, Henry. Same 760×520 canvas
-- shape as Eve's so the geometry primitives line up; per-patient
-- variation in interior walls keeps the Place tab visually distinct.
-- ─────────────────────────────────────────────────────────────────────
do $places$
declare
  v_frank_id        uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_grace_id        uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_henry_id        uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
  v_frank_plan_id   uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd2';
  v_grace_plan_id   uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd3';
  v_henry_plan_id   uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd4';
begin
  -- Frank's plan — ground-floor unit with a side door near the carpark
  -- zone (top-right) so the Restricted carpark zone alert visualisation
  -- makes sense.
  insert into public.floor_plans
    (id, patient_id, name, canvas_json, scale_meters_per_pixel)
  values (
    v_frank_plan_id, v_frank_id, 'Ground-floor unit',
    '{
      "version":"1.0",
      "objects":[
        {"type":"wall","x1":40,"y1":40,"x2":760,"y2":40},
        {"type":"wall","x1":760,"y1":40,"x2":760,"y2":520},
        {"type":"wall","x1":760,"y1":520,"x2":40,"y2":520},
        {"type":"wall","x1":40,"y1":520,"x2":40,"y2":40},
        {"type":"wall","x1":40,"y1":260,"x2":480,"y2":260},
        {"type":"wall","x1":480,"y1":260,"x2":480,"y2":40},
        {"type":"wall","x1":640,"y1":40,"x2":640,"y2":160}
      ]
    }'::jsonb,
    0.04
  )
  on conflict (id) do nothing;

  -- Grace's plan — single bedsit, smaller layout, bay-window nook
  -- (drawn as a chamfered corner top-left).
  insert into public.floor_plans
    (id, patient_id, name, canvas_json, scale_meters_per_pixel)
  values (
    v_grace_plan_id, v_grace_id, 'Bedsit',
    '{
      "version":"1.0",
      "objects":[
        {"type":"wall","x1":120,"y1":40,"x2":760,"y2":40},
        {"type":"wall","x1":760,"y1":40,"x2":760,"y2":520},
        {"type":"wall","x1":760,"y1":520,"x2":40,"y2":520},
        {"type":"wall","x1":40,"y1":520,"x2":40,"y2":160},
        {"type":"wall","x1":40,"y1":160,"x2":120,"y2":40},
        {"type":"wall","x1":40,"y1":380,"x2":280,"y2":380}
      ]
    }'::jsonb,
    0.04
  )
  on conflict (id) do nothing;

  -- Henry's plan — long room with a library nook (right-hand alcove).
  insert into public.floor_plans
    (id, patient_id, name, canvas_json, scale_meters_per_pixel)
  values (
    v_henry_plan_id, v_henry_id, 'Library suite',
    '{
      "version":"1.0",
      "objects":[
        {"type":"wall","x1":40,"y1":40,"x2":760,"y2":40},
        {"type":"wall","x1":760,"y1":40,"x2":760,"y2":520},
        {"type":"wall","x1":760,"y1":520,"x2":40,"y2":520},
        {"type":"wall","x1":40,"y1":520,"x2":40,"y2":40},
        {"type":"wall","x1":520,"y1":40,"x2":520,"y2":300},
        {"type":"wall","x1":520,"y1":300,"x2":760,"y2":300}
      ]
    }'::jsonb,
    0.04
  )
  on conflict (id) do nothing;

  -- Beacons — 4 per plan in corner positions for triangulation.
  insert into public.beacons
    (id, patient_id, floor_plan_id, mac_address, x_canvas, y_canvas, label, tx_power, rssi_at_1m)
  values
    -- Frank
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'frank-1'),
     v_frank_id, v_frank_plan_id, 'b2:00:00:00:00:01', 120, 120, 'Bedroom',  -59, -65),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'frank-2'),
     v_frank_id, v_frank_plan_id, 'b2:00:00:00:00:02', 600, 120, 'Lounge',   -59, -64),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'frank-3'),
     v_frank_id, v_frank_plan_id, 'b2:00:00:00:00:03', 200, 420, 'Kitchen',  -59, -66),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'frank-4'),
     v_frank_id, v_frank_plan_id, 'b2:00:00:00:00:04', 600, 420, 'Garden door', -59, -65),
    -- Grace
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'grace-1'),
     v_grace_id, v_grace_plan_id, 'b3:00:00:00:00:01', 200, 120, 'Window nook', -59, -65),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'grace-2'),
     v_grace_id, v_grace_plan_id, 'b3:00:00:00:00:02', 600, 120, 'Reading chair', -59, -65),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'grace-3'),
     v_grace_id, v_grace_plan_id, 'b3:00:00:00:00:03', 160, 460, 'Bed',  -59, -66),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'grace-4'),
     v_grace_id, v_grace_plan_id, 'b3:00:00:00:00:04', 600, 460, 'En-suite',  -59, -65),
    -- Henry
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'henry-1'),
     v_henry_id, v_henry_plan_id, 'b4:00:00:00:00:01', 120, 120, 'Bedroom',  -59, -65),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'henry-2'),
     v_henry_id, v_henry_plan_id, 'b4:00:00:00:00:02', 360, 120, 'Hallway',  -59, -64),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'henry-3'),
     v_henry_id, v_henry_plan_id, 'b4:00:00:00:00:03', 640, 200, 'Library nook', -59, -66),
    (uuid_generate_v5('e0000000-0000-0000-0000-000000000000'::uuid, 'henry-4'),
     v_henry_id, v_henry_plan_id, 'b4:00:00:00:00:04', 360, 460, 'Bathroom', -59, -65)
  on conflict (id) do nothing;

  raise notice 'Place: floor plans + 4 beacons each for Frank / Grace / Henry.';
end
$places$;

-- ─────────────────────────────────────────────────────────────────────
-- Calibration captures for Frank, Grace, Henry — 3 each is enough to
-- demo the Calibration tab without overloading.
-- ─────────────────────────────────────────────────────────────────────
do $more_calibration$
declare
  v_frank_plan_id  uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd2';
  v_grace_plan_id  uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd3';
  v_henry_plan_id  uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd4';
begin
  -- Frank
  if not exists (select 1 from public.calibration_points where floor_plan_id = v_frank_plan_id) then
    insert into public.calibration_points
      (id, floor_plan_id, x_canvas, y_canvas, ble_signature, captured_at)
    values
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'frank-cal-1'),
       v_frank_plan_id, 130, 140,
       '[{"mac":"b2:00:00:00:00:01","rssi":-58,"samples":18},
         {"mac":"b2:00:00:00:00:02","rssi":-78,"samples":17}]'::jsonb,
       now() - interval '4 days'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'frank-cal-2'),
       v_frank_plan_id, 590, 140,
       '[{"mac":"b2:00:00:00:00:02","rssi":-58,"samples":18},
         {"mac":"b2:00:00:00:00:01","rssi":-77,"samples":16}]'::jsonb,
       now() - interval '4 days' + interval '15 minutes'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'frank-cal-3'),
       v_frank_plan_id, 200, 420,
       '[{"mac":"b2:00:00:00:00:03","rssi":-58,"samples":18},
         {"mac":"b2:00:00:00:00:01","rssi":-79,"samples":15}]'::jsonb,
       now() - interval '4 days' + interval '30 minutes');
  end if;

  -- Grace
  if not exists (select 1 from public.calibration_points where floor_plan_id = v_grace_plan_id) then
    insert into public.calibration_points
      (id, floor_plan_id, x_canvas, y_canvas, ble_signature, captured_at)
    values
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'grace-cal-1'),
       v_grace_plan_id, 200, 130,
       '[{"mac":"b3:00:00:00:00:01","rssi":-57,"samples":18}]'::jsonb,
       now() - interval '2 days'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'grace-cal-2'),
       v_grace_plan_id, 600, 130,
       '[{"mac":"b3:00:00:00:00:02","rssi":-58,"samples":17}]'::jsonb,
       now() - interval '2 days' + interval '12 minutes'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'grace-cal-3'),
       v_grace_plan_id, 380, 280,
       '[{"mac":"b3:00:00:00:00:01","rssi":-71,"samples":17},
         {"mac":"b3:00:00:00:00:04","rssi":-72,"samples":17}]'::jsonb,
       now() - interval '2 days' + interval '24 minutes');
  end if;

  -- Henry
  if not exists (select 1 from public.calibration_points where floor_plan_id = v_henry_plan_id) then
    insert into public.calibration_points
      (id, floor_plan_id, x_canvas, y_canvas, ble_signature, captured_at)
    values
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'henry-cal-1'),
       v_henry_plan_id, 130, 130,
       '[{"mac":"b4:00:00:00:00:01","rssi":-58,"samples":18}]'::jsonb,
       now() - interval '3 days'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'henry-cal-2'),
       v_henry_plan_id, 640, 200,
       '[{"mac":"b4:00:00:00:00:03","rssi":-57,"samples":18}]'::jsonb,
       now() - interval '3 days' + interval '18 minutes'),
      (uuid_generate_v5('aa000000-0000-0000-0000-000000000000'::uuid, 'henry-cal-3'),
       v_henry_plan_id, 360, 460,
       '[{"mac":"b4:00:00:00:00:04","rssi":-58,"samples":18},
         {"mac":"b4:00:00:00:00:02","rssi":-72,"samples":17}]'::jsonb,
       now() - interval '3 days' + interval '36 minutes');
  end if;

  raise notice 'Calibration: 3 captures each for Frank / Grace / Henry.';
end
$more_calibration$;

-- ─────────────────────────────────────────────────────────────────────
-- Grace's full setup — paired device + 12h history + recent positions
-- + sensor readings, so her Live + History tabs match the others.
-- ─────────────────────────────────────────────────────────────────────
do $grace_setup$
declare
  v_grace_id         uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_grace_device_id  uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc3';
  v_now              timestamptz := now();
  v_oldest           timestamptz := now() - interval '12 hours';
begin
  -- Paired device (idempotent on id).
  insert into public.devices
    (id, mac_address, firmware_version, paired_patient_id, last_seen_at)
  values (v_grace_device_id, 'aa:bb:cc:00:00:03', '1.4.2', v_grace_id, v_now - interval '8 seconds')
  on conflict (id) do nothing;

  -- Recent positions (last minute) — Grace stays in her bedsit, near
  -- the reading chair.
  if not exists (select 1 from public.position_estimates where patient_id = v_grace_id) then
    insert into public.position_estimates
      (patient_id, recorded_at, mode, x_canvas, y_canvas, confidence)
    select
      v_grace_id,
      v_now - (i || ' seconds')::interval,
      'indoor'::public.position_mode,
      580 + (random() * 40)::numeric,
      120 + (random() * 30)::numeric,
      0.76 + random() * 0.10
    from generate_series(0, 60, 5) as t(i);
  end if;

  -- 12h backfill at 10-min intervals — small drift around two anchors
  -- (reading chair in the morning, bed in the evening).
  if not exists (
    select 1 from public.position_estimates
     where patient_id = v_grace_id
       and recorded_at < now() - interval '6 hours'
  ) then
    insert into public.position_estimates
      (patient_id, recorded_at, mode, x_canvas, y_canvas, confidence)
    select
      v_grace_id,
      v_oldest + (i * interval '10 minutes'),
      'indoor'::public.position_mode,
      case when i < 36 then 580 + (random() * 40)::numeric
           else 160 + (random() * 30)::numeric end,
      case when i < 36 then 120 + (random() * 30)::numeric
           else 460 + (random() * 30)::numeric end,
      0.72 + random() * 0.12
    from generate_series(0, 71) as t(i);

    -- Sensor readings — calmer baseline than Eve / Frank.
    insert into public.sensor_readings
      (patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c)
    select
      v_grace_id, v_grace_device_id,
      v_oldest + (i * interval '10 minutes'),
      (74 + sin(i::numeric / 7) * 3 + (random() - 0.5) * 1.5)::numeric(5,1),
      (98 - random() * 1)::numeric(4,1),
      (36.7 + (random() - 0.5) * 0.18)::numeric(4,2)
    from generate_series(0, 71) as t(i);
  end if;

  -- Recent vitals so the Live sparkline isn't empty.
  if not exists (
    select 1 from public.sensor_readings
     where patient_id = v_grace_id
       and recorded_at > now() - interval '15 minutes'
  ) then
    insert into public.sensor_readings
      (patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c)
    select
      v_grace_id, v_grace_device_id,
      v_now - (i || ' seconds')::interval,
      (74 + sin(i::numeric / 25) * 3 + (random() - 0.5) * 1.5)::numeric(5,1),
      (98 - random() * 1)::numeric(4,1),
      (36.7 + (random() - 0.5) * 0.18)::numeric(4,2)
    from generate_series(0, 600, 30) as t(i);
  end if;

  raise notice 'Grace: paired device + recent positions + 12h backfill seeded.';
end
$grace_setup$;

-- ─────────────────────────────────────────────────────────────────────
-- Grace's alert rules + a couple of fired alerts so her Settings,
-- Alerts, and dashboard counter contributions are populated.
-- ─────────────────────────────────────────────────────────────────────
do $grace_rules$
declare
  v_grace_id       uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_admin_id       uuid;
  v_anna_id        uuid := '12121212-1212-1212-1212-121212121212';
  v_rule_grace_v   uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff5';
  v_rule_grace_z   uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff6';
begin
  select id into v_admin_id from auth.users where email = 'admin@bizzieapp.com';

  -- Two rules: vitals + a "stay in the bedsit at night" zone rule.
  insert into public.alert_rules
    (id, patient_id, type, params, severity, enabled)
  values
    (v_rule_grace_v, v_grace_id, 'vitals',
     '{"metric":"hr_bpm","min":55,"max":105,"window_seconds":120}'::jsonb,
     'warn', true),
    (v_rule_grace_z, v_grace_id, 'zone',
     '{"polygon":[[40,160],[280,160],[280,380],[40,380]],"direction":"leave","label":"Bedsit only-between (night)"}'::jsonb,
     'info', true)
  on conflict (id) do nothing;

  -- Three fired alerts — one open, two acked — so her Alerts tab + the
  -- Open alerts counter both have content.
  if not exists (
    select 1 from public.alerts a
     where a.patient_id = v_grace_id
       and a.id in (
         uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'grace-alert-1'),
         uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'grace-alert-2'),
         uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'grace-alert-3')
       )
  ) then
    insert into public.alerts
      (id, patient_id, rule_id, severity, fired_at, acknowledged_at,
       ack_by_caregiver_id, context)
    values
      -- Open: Grace just left her bedsit at night.
      (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'grace-alert-1'),
       v_grace_id, v_rule_grace_z, 'info',
       now() - interval '8 minutes', null, null,
       '{"kind":"zone","direction":"leave","label":"Bedsit only-between (night)"}'::jsonb),
      -- Acked: HR spike yesterday.
      (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'grace-alert-2'),
       v_grace_id, v_rule_grace_v, 'warn',
       now() - interval '1 day' + interval '14:30',
       now() - interval '1 day' + interval '14:34', v_anna_id,
       '{"kind":"vitals","metric":"hr_bpm","value":108,"breached":"high"}'::jsonb),
      -- Acked: zone breach two nights ago.
      (uuid_generate_v5('a0000000-0000-0000-0000-000000000000'::uuid, 'grace-alert-3'),
       v_grace_id, v_rule_grace_z, 'info',
       now() - interval '2 days' + interval '23:15',
       now() - interval '2 days' + interval '23:21', coalesce(v_admin_id, v_anna_id),
       '{"kind":"zone","direction":"leave","label":"Bedsit only-between (night)"}'::jsonb)
    on conflict (id) do nothing;
  end if;

  raise notice 'Grace: 2 rules + 3 alerts seeded.';
end
$grace_rules$;

-- ─────────────────────────────────────────────────────────────────────
-- Grace's medications + administrations.
-- ─────────────────────────────────────────────────────────────────────
do $grace_meds$
declare
  v_grace_id       uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_admin_id       uuid;
  v_anna_id        uuid := '12121212-1212-1212-1212-121212121212';
  v_med_g_riv      uuid := '99999999-9999-9999-9999-999999999997'; -- Rivastigmine
  v_med_g_para     uuid := '99999999-9999-9999-9999-999999999998'; -- Paracetamol PRN
  v_med_g_vitd     uuid := '99999999-9999-9999-9999-999999999999'; -- Vitamin D
begin
  select id into v_admin_id from auth.users where email = 'admin@bizzieapp.com';

  insert into public.medications
    (id, patient_id, name, dose, route, schedule, prn, active, notes)
  values
    (v_med_g_riv, v_grace_id, 'Rivastigmine', '1.5 mg', 'oral',
     '{"times":["09:00","21:00"],"tz":"Australia/Sydney"}'::jsonb, false, true,
     'Cognitive support — start dose. Monitor for nausea over the first fortnight.'),
    (v_med_g_para, v_grace_id, 'Paracetamol', '500 mg', 'oral',
     null, true, true,
     'PRN for headache. Max 4 doses / 24 h.'),
    (v_med_g_vitd, v_grace_id, 'Vitamin D', '1000 IU', 'oral',
     '{"times":["09:00"],"tz":"Australia/Sydney"}'::jsonb, false, true,
     'Daily with breakfast.')
  on conflict (id) do nothing;

  -- A few administrations across the last 3 days.
  insert into public.medication_administrations
    (id, medication_id, scheduled_for, administered_at, administered_by, status, notes)
  values
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'grace-adm-1'),
     v_med_g_riv, now() - interval '2 days' + interval '09:00',
     now() - interval '2 days' + interval '09:08', v_anna_id, 'given', null),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'grace-adm-2'),
     v_med_g_vitd, now() - interval '2 days' + interval '09:00',
     now() - interval '2 days' + interval '09:09', v_anna_id, 'given', null),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'grace-adm-3'),
     v_med_g_riv, now() - interval '1 day' + interval '21:00',
     now() - interval '1 day' + interval '21:14', v_anna_id, 'given',
     'Slight nausea afterward — within expected tolerance window.'),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'grace-adm-4'),
     v_med_g_para, null,
     now() - interval '4 hours', coalesce(v_admin_id, v_anna_id), 'given',
     'PRN — Grace mentioned a mild headache after the morning visit.'),
    (uuid_generate_v5('a2000000-0000-0000-0000-000000000000'::uuid, 'grace-adm-5'),
     v_med_g_riv, date_trunc('day', now()) + interval '09:00',
     date_trunc('day', now()) + interval '09:11', v_anna_id, 'given', null)
  on conflict (id) do nothing;

  raise notice 'Grace: 3 medications + 5 administrations seeded.';
end
$grace_meds$;

-- ─────────────────────────────────────────────────────────────────────
-- Unpaired devices — populate the device discovery flow on the Live
-- tab so the pairing path has something to find.
-- ─────────────────────────────────────────────────────────────────────
do $unpaired$
begin
  insert into public.devices
    (id, mac_address, firmware_version, paired_patient_id, last_seen_at)
  values
    (uuid_generate_v5('cd000000-0000-0000-0000-000000000000'::uuid, 'unpaired-1'),
     'aa:bb:cc:00:00:11', '1.4.3', null, now() - interval '15 seconds'),
    (uuid_generate_v5('cd000000-0000-0000-0000-000000000000'::uuid, 'unpaired-2'),
     'aa:bb:cc:00:00:12', '1.4.2', null, now() - interval '40 seconds'),
    (uuid_generate_v5('cd000000-0000-0000-0000-000000000000'::uuid, 'unpaired-3'),
     'aa:bb:cc:00:00:13', '1.3.9', null, now() - interval '2 minutes')
  on conflict (id) do nothing;

  raise notice 'Discovery: 3 unpaired devices visible on the Live tab pairing panel.';
end
$unpaired$;

-- ============================================================================
-- Project peers — group-member demo accounts
-- ============================================================================
--
-- All four peers join Acme Care Co as admins so each can exercise every
-- feature (Audit log tab, Members tab role promotions, medication list
-- edits, full patient roster). Member-tier behaviour is still
-- demonstrable via the Anna / Priya seeded accounts above.
--
--   Olivia    103642997@student.swin.edu.au   admin
--   Mohamed   104341981@student.swin.edu.au   admin
--   Noor      104171926@student.swin.edu.au   admin
--   Hongting  105961089@student.swin.edu.au   admin
--
-- Password for all four: demo1234!  (change via /profile after first login)
-- ============================================================================
do $peers$
declare
  v_provider_id  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_olivia_id    uuid := '15151515-1515-1515-1515-151515151515';
  v_mohamed_id   uuid := '16161616-1616-1616-1616-161616161616';
  v_noor_id      uuid := '17171717-1717-1717-1717-171717171717';
  v_hongting_id  uuid := '18181818-1818-1818-1818-181818181818';
  v_eve_id       uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_frank_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_grace_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_henry_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
begin
  -- Olivia (admin)
  if not exists (select 1 from auth.users where id = v_olivia_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_olivia_id,
      'authenticated', 'authenticated',
      '103642997@student.swin.edu.au',
      crypt('demo1234!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Olivia","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Mohamed (admin)
  if not exists (select 1 from auth.users where id = v_mohamed_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_mohamed_id,
      'authenticated', 'authenticated',
      '104341981@student.swin.edu.au',
      crypt('demo1234!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Mohamed","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Noor (member)
  if not exists (select 1 from auth.users where id = v_noor_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_noor_id,
      'authenticated', 'authenticated',
      '104171926@student.swin.edu.au',
      crypt('demo1234!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Noor","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Hongting (member)
  if not exists (select 1 from auth.users where id = v_hongting_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_hongting_id,
      'authenticated', 'authenticated',
      '105961089@student.swin.edu.au',
      crypt('demo1234!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Hongting","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Bind tenant + role via the trigger bypass.
  perform set_config('alzcare.role_change_authorized', 'true', true);

  update public.caregivers
     set care_provider_id = v_provider_id,
         provider_role    = 'admin'::public.caregiver_provider_role,
         company_name     = coalesce(company_name, 'Acme Care Co')
   where id in (v_olivia_id, v_mohamed_id, v_noor_id, v_hongting_id);

  -- Every peer is allocated to every patient — admin scope already
  -- grants them visibility, but explicit caregiver_patient rows make
  -- them appear on each patient's Caregivers tab too.
  insert into public.caregiver_patient (caregiver_id, patient_id) values
    (v_olivia_id,  v_eve_id),     (v_olivia_id,  v_frank_id),
    (v_olivia_id,  v_grace_id),   (v_olivia_id,  v_henry_id),
    (v_mohamed_id, v_eve_id),     (v_mohamed_id, v_frank_id),
    (v_mohamed_id, v_grace_id),   (v_mohamed_id, v_henry_id),
    (v_noor_id,    v_eve_id),     (v_noor_id,    v_frank_id),
    (v_noor_id,    v_grace_id),   (v_noor_id,    v_henry_id),
    (v_hongting_id, v_eve_id),    (v_hongting_id, v_frank_id),
    (v_hongting_id, v_grace_id),  (v_hongting_id, v_henry_id)
  on conflict (caregiver_id, patient_id) do nothing;

  raise notice 'Peers: Olivia / Mohamed / Noor / Hongting all admin in Acme Care Co (password demo1234!).';
end
$peers$;

