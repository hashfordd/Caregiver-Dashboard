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
