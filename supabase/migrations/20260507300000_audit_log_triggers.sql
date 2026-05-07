-- Phase D items 37 + 38: audit log triggers + admin SELECT policy.
--
-- Approach:
--
-- 1. A single trigger function `audit_log_record()` writes one row to
--    `audit_log` per write. The function resolves the provider tenant
--    for the row and stores it in the payload as `audit_provider_id`.
--    Storing the resolved tenant *at trigger time* (rather than joining
--    live tables at SELECT time) means the audit row remains visible
--    after the underlying row is deleted — and keeps the SELECT policy
--    a one-line predicate.
--
-- 2. Apply the trigger to: patients, caregiver_patient, devices,
--    floor_plans, beacons, calibration_points, alert_rules, alerts
--    (UPDATE only — acknowledgement is the audit-relevant lifecycle),
--    patient_notes.
--
-- 3. SELECT policy admits provider admins of the embedded tenant. Sets
--    a single tenancy boundary: admins see audit rows for their
--    provider; everyone else sees nothing.
--
-- Limitations: the trigger runs after RLS, so when the bridge writes
-- via service-role and bypasses RLS, the audit row still gets a
-- provider stamp. auth.uid() may be NULL in service-role contexts —
-- that's fine; actor_id is nullable and the row still attributes to
-- the table+target.

-- ─────────────────────────────────────────────────────────────────────────
-- Provider resolver
-- ─────────────────────────────────────────────────────────────────────────
-- Given a table name and the full row as JSONB, return the
-- care_provider_id this row belongs to. Returns NULL when unresolvable
-- (e.g. an unpaired device, or the row isn't tenant-scoped).
create or replace function public.audit_log_resolve_provider(
  p_table text,
  p_row jsonb
) returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_provider uuid;
  v_patient_id uuid;
  v_caregiver_id uuid;
  v_floor_plan_id uuid;
begin
  case p_table
    when 'patients' then
      v_provider := (p_row->>'care_provider_id')::uuid;

    when 'caregiver_patient' then
      v_patient_id := (p_row->>'patient_id')::uuid;
      if v_patient_id is not null then
        select care_provider_id into v_provider from public.patients where id = v_patient_id;
      end if;

    when 'devices' then
      v_patient_id := (p_row->>'paired_patient_id')::uuid;
      if v_patient_id is not null then
        select care_provider_id into v_provider from public.patients where id = v_patient_id;
      end if;

    when 'floor_plans', 'beacons', 'alert_rules', 'alerts',
         'patient_notes', 'sensor_readings', 'position_estimates', 'events' then
      v_patient_id := (p_row->>'patient_id')::uuid;
      if v_patient_id is not null then
        select care_provider_id into v_provider from public.patients where id = v_patient_id;
      end if;

    when 'calibration_points' then
      v_floor_plan_id := (p_row->>'floor_plan_id')::uuid;
      if v_floor_plan_id is not null then
        select p.care_provider_id into v_provider
          from public.floor_plans fp
          join public.patients p on p.id = fp.patient_id
         where fp.id = v_floor_plan_id;
      end if;

    when 'caregivers' then
      v_caregiver_id := (p_row->>'id')::uuid;
      if v_caregiver_id is not null then
        select care_provider_id into v_provider from public.caregivers where id = v_caregiver_id;
      end if;

    else
      v_provider := null;
  end case;

  return v_provider;
end;
$$;

revoke all on function public.audit_log_resolve_provider(text, jsonb) from public;

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger function: writes one audit_log row per INSERT/UPDATE/DELETE.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.audit_log_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_provider uuid;
  v_target_id uuid;
begin
  -- Pick the row that drives provider resolution and target_id.
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  v_provider := public.audit_log_resolve_provider(tg_table_name, v_row);
  v_target_id := nullif(v_row->>'id', '')::uuid;

  -- Build before/after snapshots. UPDATE captures both; INSERT only after;
  -- DELETE only before. audit_provider_id is the tenancy stamp the
  -- SELECT policy reads.
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  insert into public.audit_log (actor_id, action, target_table, target_id, payload)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    v_target_id,
    jsonb_strip_nulls(jsonb_build_object(
      'audit_provider_id', v_provider,
      'before', v_old,
      'after', v_new
    ))
  );

  return coalesce(new, old);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Attach triggers
-- ─────────────────────────────────────────────────────────────────────────
create trigger audit_patients
  after insert or update or delete on public.patients
  for each row execute function public.audit_log_record();

create trigger audit_caregiver_patient
  after insert or update or delete on public.caregiver_patient
  for each row execute function public.audit_log_record();

create trigger audit_devices
  after insert or update or delete on public.devices
  for each row execute function public.audit_log_record();

create trigger audit_floor_plans
  after insert or update or delete on public.floor_plans
  for each row execute function public.audit_log_record();

create trigger audit_beacons
  after insert or update or delete on public.beacons
  for each row execute function public.audit_log_record();

create trigger audit_calibration_points
  after insert or update or delete on public.calibration_points
  for each row execute function public.audit_log_record();

create trigger audit_alert_rules
  after insert or update or delete on public.alert_rules
  for each row execute function public.audit_log_record();

create trigger audit_alerts_acknowledge
  after update on public.alerts
  for each row execute function public.audit_log_record();

create trigger audit_patient_notes
  after insert or update or delete on public.patient_notes
  for each row execute function public.audit_log_record();

-- ─────────────────────────────────────────────────────────────────────────
-- Admin SELECT policy: provider admins see audit rows for their tenant.
-- ─────────────────────────────────────────────────────────────────────────
-- Drop the old TODO-policy if anything was added later (defensive).
drop policy if exists audit_log_admin_read on public.audit_log;

create policy audit_log_admin_read on public.audit_log
  for select using (
    public.is_provider_admin(((payload->>'audit_provider_id'))::uuid)
  );

comment on policy audit_log_admin_read on public.audit_log is
  'Provider admins read audit rows whose payload.audit_provider_id matches their provider. Non-admins see nothing.';
