-- Phase II.B: care plan + wandering-risk profile.
--
-- Adds the non-telemetry side of the patient record so caregivers can
-- capture clinical context that the BLE/MQTT pipeline doesn't see —
-- dementia stage, wandering-risk band, behavioural triggers,
-- shift-handover summary, and free-form preferences.
--
-- All columns are NOT NULL with sensible defaults so the existing
-- patient rows pass without a backfill. Stage and risk use plain
-- text + check constraints rather than enum types so a future
-- additional band (e.g. 'late' stage, 'critical' risk) can land via
-- a single ALTER … DROP CONSTRAINT … ADD CONSTRAINT pair instead of
-- the heavier ALTER TYPE … ADD VALUE choreography.
--
-- RLS: patients_tenant_update (20260507104000) already authorises any
-- allocated caregiver or tenant admin to UPDATE the row, so the new
-- columns are writable without a new policy. Audit triggers
-- (20260507300000) serialise the whole row and so cover the new
-- columns automatically.

alter table public.patients
  add column dementia_stage     text not null default 'unknown'
    check (dementia_stage in ('unknown', 'early', 'moderate', 'advanced')),
  add column wandering_risk     text not null default 'low'
    check (wandering_risk in ('low', 'medium', 'high')),
  add column known_triggers     text[] not null default '{}',
  add column care_plan_summary  text,
  add column preferences        jsonb not null default '{}'::jsonb;

comment on column public.patients.dementia_stage is
  'Caregiver-recorded dementia stage. Drives clinical context surfaces; not consumed by the rules engine.';
comment on column public.patients.wandering_risk is
  'Caregiver-set wandering risk band. Surfaces as a badge on the situation-room grid + patient header.';
comment on column public.patients.known_triggers is
  'Behavioural triggers documented by the care team (e.g. "loud noises", "afternoon agitation").';
comment on column public.patients.care_plan_summary is
  'Free-text shift-handover summary. Renders in the Care plan tab.';
comment on column public.patients.preferences is
  'Patient preferences and routines as a JSONB key/value bag. Schema-less to stay flexible until usage patterns settle.';

-- Replace the 'unknown' placeholder from PR-1 with the real column.
-- Function signature is unchanged so all PostgREST + frontend callers
-- continue to work without recompilation.
create or replace function public.get_situation_overview()
returns table (
  patient_id           uuid,
  full_name            text,
  care_provider_id     uuid,
  last_position_at     timestamptz,
  last_position_mode   public.position_mode,
  last_position_x      numeric,
  last_position_y      numeric,
  last_position_lat    numeric,
  last_position_lng    numeric,
  wandering_risk       text
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
    p.wandering_risk
  from public.patients p
  left join lateral (
    select recorded_at, mode, x_canvas, y_canvas, lat, lng
      from public.position_estimates pe
     where pe.patient_id = p.id
     order by pe.recorded_at desc
     limit 1
  ) pos on true
  where public.can_access_patient(p.id)
  order by p.full_name nulls last;
$$;
