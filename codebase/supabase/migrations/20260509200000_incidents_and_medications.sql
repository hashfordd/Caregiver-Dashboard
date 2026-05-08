-- Phase II.C: incidents + medications.
--
-- Adds two human-facing care surfaces that are distinct from the
-- machine-fired alert pipeline:
--
--   * incidents          — caregiver-logged events (falls, agitation,
--                          refusals, wanders, medication events, other).
--                          Human authorship + free-form description so
--                          the team has a narrative trail per patient.
--
--   * medications        — patient's medication list (admin-edited).
--   * medication_admins  — per-dose log: who gave what, when, status.
--                          V1 is purely manual ("mark given/refused/
--                          skipped"); pg_cron-driven schedule
--                          materialisation is deferred (see BACKLOG).
--
-- RLS pattern matches alert_rules / patient_notes:
--   read+insert via can_access_patient (allocated caregiver or admin),
--   update/delete on medications restricted to provider admins.
--
-- Audit triggers reuse audit_log_record from 20260507300000 — no
-- changes needed beyond attaching them to the new tables.

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────
create type public.incident_type as enum (
  'fall',
  'agitation',
  'refusal',
  'wander',
  'medication_event',
  'other'
);

create type public.medication_admin_status as enum (
  'given',
  'refused',
  'skipped',
  'missed'
);

-- ─────────────────────────────────────────────────────────────────────────
-- incidents
-- ─────────────────────────────────────────────────────────────────────────
create table public.incidents (
  id                    uuid primary key default gen_random_uuid(),
  patient_id            uuid not null references public.patients(id) on delete cascade,
  logged_by             uuid references public.caregivers(id) on delete set null,
  occurred_at           timestamptz not null default now(),
  type                  public.incident_type not null,
  severity              smallint not null check (severity between 1 and 3),
  description           text not null check (length(trim(description)) > 0),
  follow_up_required    boolean not null default false,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index incidents_patient_occurred_idx
  on public.incidents(patient_id, occurred_at desc);

create index incidents_unresolved_idx
  on public.incidents(patient_id) where resolved_at is null;

alter table public.incidents enable row level security;

create policy incidents_tenant_read on public.incidents
  for select using (public.can_access_patient(patient_id));

create policy incidents_tenant_insert on public.incidents
  for insert with check (
    public.can_access_patient(patient_id)
    and logged_by = auth.uid()
  );

-- Author can update (correct typos, mark resolved) within their session;
-- admins of the tenant can update anyone's row to clean up the record.
create policy incidents_author_or_admin_update on public.incidents
  for update using (
    logged_by = auth.uid()
    or public.is_provider_admin(
         (select care_provider_id from public.patients where id = patient_id)
       )
  ) with check (
    logged_by = auth.uid()
    or public.is_provider_admin(
         (select care_provider_id from public.patients where id = patient_id)
       )
  );

create policy incidents_author_delete on public.incidents
  for delete using (logged_by = auth.uid());

-- updated_at maintainer
create or replace function public.touch_incident_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger incidents_touch_updated_at
  before update on public.incidents
  for each row execute function public.touch_incident_updated_at();

-- Audit trigger
create trigger audit_incidents
  after insert or update or delete on public.incidents
  for each row execute function public.audit_log_record();

-- audit_log_resolve_provider needs to know how to resolve incidents →
-- patient → provider. Extend the case statement.
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
  v_medication_id uuid;
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
         'patient_notes', 'sensor_readings', 'position_estimates',
         'events', 'incidents', 'medications' then
      v_patient_id := (p_row->>'patient_id')::uuid;
      if v_patient_id is not null then
        select care_provider_id into v_provider from public.patients where id = v_patient_id;
      end if;

    when 'medication_administrations' then
      v_medication_id := (p_row->>'medication_id')::uuid;
      if v_medication_id is not null then
        select p.care_provider_id into v_provider
          from public.medications m
          join public.patients p on p.id = m.patient_id
         where m.id = v_medication_id;
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

-- ─────────────────────────────────────────────────────────────────────────
-- medications + medication_administrations
-- ─────────────────────────────────────────────────────────────────────────
create table public.medications (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  dose            text,
  route           text,
  -- V1 schedule shape: { "times": ["08:00","20:00"], "tz": "Australia/Sydney" }
  -- prn = true means "as needed"; schedule may be null in that case.
  schedule        jsonb,
  prn             boolean not null default false,
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index medications_patient_active_idx
  on public.medications(patient_id) where active;

alter table public.medications enable row level security;

create policy medications_tenant_read on public.medications
  for select using (public.can_access_patient(patient_id));

-- Editing the medication list (the prescription) is admin-only —
-- caregivers shouldn't add/remove medications, only log administrations.
create policy medications_admin_insert on public.medications
  for insert with check (
    public.is_provider_admin(
      (select care_provider_id from public.patients where id = patient_id)
    )
  );

create policy medications_admin_update on public.medications
  for update using (
    public.is_provider_admin(
      (select care_provider_id from public.patients where id = patient_id)
    )
  ) with check (
    public.is_provider_admin(
      (select care_provider_id from public.patients where id = patient_id)
    )
  );

create policy medications_admin_delete on public.medications
  for delete using (
    public.is_provider_admin(
      (select care_provider_id from public.patients where id = patient_id)
    )
  );

create or replace function public.touch_medication_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger medications_touch_updated_at
  before update on public.medications
  for each row execute function public.touch_medication_updated_at();

create trigger audit_medications
  after insert or update or delete on public.medications
  for each row execute function public.audit_log_record();

-- ─────────────────────────────────────────────────────────────────────────
-- medication_administrations — per-dose log.
-- ─────────────────────────────────────────────────────────────────────────
create table public.medication_administrations (
  id                  uuid primary key default gen_random_uuid(),
  medication_id       uuid not null references public.medications(id) on delete cascade,
  scheduled_for       timestamptz,
  administered_at     timestamptz,
  administered_by     uuid references public.caregivers(id) on delete set null,
  status              public.medication_admin_status not null default 'given',
  notes               text,
  created_at          timestamptz not null default now()
);

create index medication_administrations_med_scheduled_idx
  on public.medication_administrations(medication_id, scheduled_for nulls last);

alter table public.medication_administrations enable row level security;

create policy med_admin_tenant_read on public.medication_administrations
  for select using (
    exists (
      select 1 from public.medications m
      where m.id = medication_administrations.medication_id
        and public.can_access_patient(m.patient_id)
    )
  );

-- Allocated caregivers + admins can log administrations.
create policy med_admin_allocated_insert on public.medication_administrations
  for insert with check (
    administered_by = auth.uid()
    and exists (
      select 1 from public.medications m
      where m.id = medication_administrations.medication_id
        and public.can_access_patient(m.patient_id)
    )
  );

-- Author corrects their own row; admins can correct anyone's.
create policy med_admin_author_or_admin_update on public.medication_administrations
  for update using (
    administered_by = auth.uid()
    or exists (
      select 1 from public.medications m
      join public.patients p on p.id = m.patient_id
      where m.id = medication_administrations.medication_id
        and public.is_provider_admin(p.care_provider_id)
    )
  ) with check (
    administered_by = auth.uid()
    or exists (
      select 1 from public.medications m
      join public.patients p on p.id = m.patient_id
      where m.id = medication_administrations.medication_id
        and public.is_provider_admin(p.care_provider_id)
    )
  );

create trigger audit_medication_administrations
  after insert or update or delete on public.medication_administrations
  for each row execute function public.audit_log_record();

-- ─────────────────────────────────────────────────────────────────────────
-- Extend get_situation_overview() with the dashboard counts.
--
-- DROP-then-CREATE rather than CREATE OR REPLACE: PostgreSQL rejects
-- a return-type change to an existing function with
-- 'cannot change return type of existing function' (SQLSTATE 42P13),
-- so the additive column expansion needs the function dropped first.
-- Frontend callers reach the function via PostgREST `rpc()` — name
-- only, no signature pinning — so the drop is invisible to them.
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.get_situation_overview();

create or replace function public.get_situation_overview()
returns table (
  patient_id                       uuid,
  full_name                        text,
  care_provider_id                 uuid,
  last_position_at                 timestamptz,
  last_position_mode               public.position_mode,
  last_position_x                  numeric,
  last_position_y                  numeric,
  last_position_lat                numeric,
  last_position_lng                numeric,
  wandering_risk                   text,
  unresolved_incidents_24h_count   bigint,
  active_medications_count         bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id                    as patient_id,
    p.full_name,
    p.care_provider_id,
    pos.recorded_at         as last_position_at,
    pos.mode                as last_position_mode,
    pos.x_canvas            as last_position_x,
    pos.y_canvas            as last_position_y,
    pos.lat                 as last_position_lat,
    pos.lng                 as last_position_lng,
    p.wandering_risk,
    coalesce(inc.unresolved_24h, 0)::bigint as unresolved_incidents_24h_count,
    coalesce(meds.active_count, 0)::bigint  as active_medications_count
  from public.patients p
  left join lateral (
    select recorded_at, mode, x_canvas, y_canvas, lat, lng
      from public.position_estimates pe
     where pe.patient_id = p.id
     order by pe.recorded_at desc
     limit 1
  ) pos on true
  left join lateral (
    select count(*) as unresolved_24h
      from public.incidents i
     where i.patient_id = p.id
       and i.resolved_at is null
       and i.occurred_at > now() - interval '24 hours'
  ) inc on true
  left join lateral (
    select count(*) as active_count
      from public.medications m
     where m.patient_id = p.id
       and m.active
  ) meds on true
  where public.can_access_patient(p.id)
  order by p.full_name nulls last;
$$;
