-- Phase B step 5: update RLS policies app-wide so provider admins see
-- (and can write) all rows in their tenant, while caregivers retain
-- the existing allocated-only access.
--
-- Pattern: each per-patient policy's predicate becomes
-- `public.can_access_patient(patient_id)`, which expands to
--   is_caregiver_for(p) OR is_provider_admin(provider_for(p))
--
-- Policies on every per-patient table are dropped and recreated. Every
-- DROP uses `if exists` so the migration is idempotent across local
-- resets.
--
-- Audit log RLS lives in Phase D (item 38) — not touched here.

-- ─────────────────────────────────────────────────────────────────────────
-- patients
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists patients_allocated_read on public.patients;
drop policy if exists patients_allocated_update on public.patients;
drop policy if exists patients_allocated_delete on public.patients;

create policy patients_tenant_read on public.patients
  for select using (
    public.is_caregiver_for(id)
    or public.is_provider_admin(care_provider_id)
  );
create policy patients_tenant_update on public.patients
  for update using (
    public.is_caregiver_for(id)
    or public.is_provider_admin(care_provider_id)
  ) with check (
    public.is_caregiver_for(id)
    or public.is_provider_admin(care_provider_id)
  );
create policy patients_tenant_delete on public.patients
  for delete using (public.is_provider_admin(care_provider_id));

-- ─────────────────────────────────────────────────────────────────────────
-- caregivers — peer-read inside the same provider so the allocation UI
-- can list members. Self-read remains for the no-provider state.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists caregivers_self_read on public.caregivers;

create policy caregivers_self_or_peer_read on public.caregivers
  for select using (
    id = auth.uid()
    or (
      care_provider_id is not null
      and care_provider_id = public.provider_for_caregiver(auth.uid())
    )
  );

-- Self-update preserved from foundation migration. Admin-promote /
-- demote is via the RPCs in 20260507105000–106000.
-- (caregivers_self_update unchanged.)

-- ─────────────────────────────────────────────────────────────────────────
-- caregiver_patient — admins of the tenant can read/insert/delete; a
-- caregiver may still leave (delete their own row).
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists caregiver_patient_self_read on public.caregiver_patient;
drop policy if exists caregiver_patient_self_delete on public.caregiver_patient;

create policy caregiver_patient_tenant_read on public.caregiver_patient
  for select using (
    caregiver_id = auth.uid()
    or public.is_provider_admin(public.provider_for_caregiver(caregiver_id))
  );
create policy caregiver_patient_admin_insert on public.caregiver_patient
  for insert with check (
    public.is_provider_admin(public.provider_for_caregiver(caregiver_id))
  );
create policy caregiver_patient_admin_delete on public.caregiver_patient
  for delete using (
    caregiver_id = auth.uid()
    or public.is_provider_admin(public.provider_for_caregiver(caregiver_id))
  );

-- ─────────────────────────────────────────────────────────────────────────
-- devices — discovery (unpaired) is open to authenticated callers; paired
-- devices follow the patient's tenant.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists devices_allocated_read on public.devices;
drop policy if exists devices_allocated_insert on public.devices;
drop policy if exists devices_allocated_update on public.devices;
drop policy if exists devices_allocated_delete on public.devices;

create policy devices_tenant_read on public.devices
  for select using (
    paired_patient_id is null
    or public.can_access_patient(paired_patient_id)
  );
create policy devices_tenant_insert on public.devices
  for insert with check (
    paired_patient_id is not null
    and public.can_access_patient(paired_patient_id)
  );
create policy devices_tenant_update on public.devices
  for update using (
    paired_patient_id is null
    or public.can_access_patient(paired_patient_id)
  ) with check (
    paired_patient_id is null
    or public.can_access_patient(paired_patient_id)
  );
create policy devices_tenant_delete on public.devices
  for delete using (
    paired_patient_id is null
    or public.can_access_patient(paired_patient_id)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- floor_plans
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists floor_plans_allocated_read on public.floor_plans;
drop policy if exists floor_plans_allocated_insert on public.floor_plans;
drop policy if exists floor_plans_allocated_update on public.floor_plans;
drop policy if exists floor_plans_allocated_delete on public.floor_plans;

create policy floor_plans_tenant_read on public.floor_plans
  for select using (public.can_access_patient(patient_id));
create policy floor_plans_tenant_insert on public.floor_plans
  for insert with check (public.can_access_patient(patient_id));
create policy floor_plans_tenant_update on public.floor_plans
  for update using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id));
create policy floor_plans_tenant_delete on public.floor_plans
  for delete using (public.can_access_patient(patient_id));

-- ─────────────────────────────────────────────────────────────────────────
-- beacons
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists beacons_allocated_read on public.beacons;
drop policy if exists beacons_allocated_insert on public.beacons;
drop policy if exists beacons_allocated_update on public.beacons;
drop policy if exists beacons_allocated_delete on public.beacons;

create policy beacons_tenant_read on public.beacons
  for select using (public.can_access_patient(patient_id));
create policy beacons_tenant_insert on public.beacons
  for insert with check (public.can_access_patient(patient_id));
create policy beacons_tenant_update on public.beacons
  for update using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id));
create policy beacons_tenant_delete on public.beacons
  for delete using (public.can_access_patient(patient_id));

-- ─────────────────────────────────────────────────────────────────────────
-- calibration_points (joins through floor_plans)
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists calibration_points_allocated_read on public.calibration_points;
drop policy if exists calibration_points_allocated_insert on public.calibration_points;
drop policy if exists calibration_points_allocated_update on public.calibration_points;
drop policy if exists calibration_points_allocated_delete on public.calibration_points;

create policy calibration_points_tenant_read on public.calibration_points
  for select using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.can_access_patient(fp.patient_id)
    )
  );
create policy calibration_points_tenant_insert on public.calibration_points
  for insert with check (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.can_access_patient(fp.patient_id)
    )
  );
create policy calibration_points_tenant_update on public.calibration_points
  for update using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.can_access_patient(fp.patient_id)
    )
  ) with check (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.can_access_patient(fp.patient_id)
    )
  );
create policy calibration_points_tenant_delete on public.calibration_points
  for delete using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.can_access_patient(fp.patient_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- sensor_readings (read-only — service-role inserts; admins see tenant)
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists sensor_readings_allocated_read on public.sensor_readings;

create policy sensor_readings_tenant_read on public.sensor_readings
  for select using (public.can_access_patient(patient_id));

-- ─────────────────────────────────────────────────────────────────────────
-- position_estimates (read-only)
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists position_estimates_allocated_read on public.position_estimates;

create policy position_estimates_tenant_read on public.position_estimates
  for select using (public.can_access_patient(patient_id));

-- ─────────────────────────────────────────────────────────────────────────
-- alert_rules
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists alert_rules_allocated_read on public.alert_rules;
drop policy if exists alert_rules_allocated_insert on public.alert_rules;
drop policy if exists alert_rules_allocated_update on public.alert_rules;
drop policy if exists alert_rules_allocated_delete on public.alert_rules;

create policy alert_rules_tenant_read on public.alert_rules
  for select using (public.can_access_patient(patient_id));
create policy alert_rules_tenant_insert on public.alert_rules
  for insert with check (public.can_access_patient(patient_id));
create policy alert_rules_tenant_update on public.alert_rules
  for update using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id));
create policy alert_rules_tenant_delete on public.alert_rules
  for delete using (public.can_access_patient(patient_id));

-- ─────────────────────────────────────────────────────────────────────────
-- alerts (read-only — ack via RPC)
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists alerts_allocated_read on public.alerts;

create policy alerts_tenant_read on public.alerts
  for select using (public.can_access_patient(patient_id));

-- ─────────────────────────────────────────────────────────────────────────
-- events (read-only — service-role inserts)
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists events_allocated_read on public.events;

create policy events_tenant_read on public.events
  for select using (public.can_access_patient(patient_id));

-- ─────────────────────────────────────────────────────────────────────────
-- patient_notes — author keeps update/delete; tenant + author for insert
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists patient_notes_allocated_read on public.patient_notes;
drop policy if exists patient_notes_allocated_insert on public.patient_notes;
drop policy if exists patient_notes_author_update on public.patient_notes;
drop policy if exists patient_notes_author_delete on public.patient_notes;

create policy patient_notes_tenant_read on public.patient_notes
  for select using (public.can_access_patient(patient_id));
create policy patient_notes_tenant_insert on public.patient_notes
  for insert with check (
    public.can_access_patient(patient_id)
    and author_caregiver_id = auth.uid()
  );
create policy patient_notes_author_update on public.patient_notes
  for update using (author_caregiver_id = auth.uid())
  with check (author_caregiver_id = auth.uid());
create policy patient_notes_author_delete on public.patient_notes
  for delete using (author_caregiver_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- care_providers — admins can update name (read policy was added with
-- the table in 20260507100000).
-- ─────────────────────────────────────────────────────────────────────────
create policy care_providers_admin_update on public.care_providers
  for update using (public.is_provider_admin(id))
  with check (public.is_provider_admin(id));
