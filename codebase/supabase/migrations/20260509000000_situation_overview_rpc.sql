-- Phase II.A: situation-room dashboard.
--
-- get_situation_overview() returns one row per patient the caller can
-- access (via can_access_patient — allocated caregiver OR provider
-- admin), with the latest position estimate folded in. The dashboard
-- composes this with the existing useAllocatedAlerts hook for the
-- alert stream + open-alert counts; this RPC stays narrow so a future
-- materialised view can replace its body without changing callers.
--
-- Why a SECURITY DEFINER RPC instead of a client-side select+lateral:
-- PostgREST doesn't expose `distinct on` cleanly, and the per-patient
-- "latest position" join is the load-bearing piece. A function lets us
-- write the lateral once + benefit from the existing
-- position_estimates_patient_recorded_idx (patient_id, recorded_at desc).
--
-- wandering_risk is returned as a literal 'unknown' placeholder. PR-2
-- (Phase II.B — care plan & risk profile) adds the real column on
-- patients and replaces the literal with `p.wandering_risk` without
-- changing the function signature.

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
    'unknown'::text         as wandering_risk
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

revoke all on function public.get_situation_overview() from public;
grant execute on function public.get_situation_overview() to authenticated;
