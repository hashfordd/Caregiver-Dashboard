-- Phase II.E: care provider home — overview + audit-log RPCs.
--
-- The dashboard's situation-overview is patient-centric. The provider
-- home rolls those numbers up to the tenant level so admins can see
-- their team's posture across the whole roster.
--
-- get_provider_overview()  → KPIs (patients, caregivers, open alerts,
--                            unresolved incidents 24h, doses + notes
--                            in 24h, average ack time over 7 days).
--                            Returns one row per the caller's provider.
--
-- get_provider_audit_log() → recent audit_log entries for the caller's
--                            provider, joined with caregivers for the
--                            actor display name. Admin-only — non-admin
--                            callers get an empty result set.

-- ─────────────────────────────────────────────────────────────────────────
-- get_provider_overview
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.get_provider_overview()
returns table (
  provider_id              uuid,
  patient_count            bigint,
  caregiver_count          bigint,
  admin_count              bigint,
  open_alerts_count        bigint,
  unresolved_incidents_24h bigint,
  doses_logged_24h         bigint,
  notes_logged_24h         bigint,
  avg_ack_minutes_7d       numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with me as (
    select care_provider_id
      from public.caregivers
     where id = auth.uid()
  )
  select
    me.care_provider_id                                                as provider_id,

    (select count(*)
       from public.patients p
      where p.care_provider_id = me.care_provider_id)                  as patient_count,

    (select count(*)
       from public.caregivers c
      where c.care_provider_id = me.care_provider_id)                  as caregiver_count,

    (select count(*)
       from public.caregivers c
      where c.care_provider_id = me.care_provider_id
        and c.provider_role = 'admin')                                 as admin_count,

    (select count(*)
       from public.alerts a
       join public.patients p on p.id = a.patient_id
      where p.care_provider_id = me.care_provider_id
        and a.acknowledged_at is null)                                 as open_alerts_count,

    (select count(*)
       from public.incidents i
       join public.patients p on p.id = i.patient_id
      where p.care_provider_id = me.care_provider_id
        and i.resolved_at is null
        and i.occurred_at > now() - interval '24 hours')               as unresolved_incidents_24h,

    (select count(*)
       from public.medication_administrations ma
       join public.medications m on m.id = ma.medication_id
       join public.patients p on p.id = m.patient_id
      where p.care_provider_id = me.care_provider_id
        and ma.created_at > now() - interval '24 hours')               as doses_logged_24h,

    (select count(*)
       from public.patient_notes n
       join public.patients p on p.id = n.patient_id
      where p.care_provider_id = me.care_provider_id
        and n.created_at > now() - interval '24 hours')                as notes_logged_24h,

    (select round(extract(epoch from avg(a.acknowledged_at - a.fired_at)) / 60, 1)
       from public.alerts a
       join public.patients p on p.id = a.patient_id
      where p.care_provider_id = me.care_provider_id
        and a.acknowledged_at is not null
        and a.fired_at > now() - interval '7 days')                    as avg_ack_minutes_7d

    from me
   where me.care_provider_id is not null;
$$;

revoke all on function public.get_provider_overview() from public;
grant execute on function public.get_provider_overview() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- get_provider_audit_log
--
-- audit_log_admin_read (Phase D, 20260507300000) already restricts the
-- table to provider admins of the embedded tenant. We could rely on
-- that — but a SECURITY DEFINER RPC lets us:
--   1. Join caregivers for actor display names without needing a peer
--      read on caregivers.
--   2. Cap the limit + sort server-side.
-- The provider_role check inside the WITH clause means non-admin
-- callers get zero rows even though they could call the function.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.get_provider_audit_log(p_limit int default 100)
returns table (
  id            uuid,
  actor_id      uuid,
  actor_name    text,
  action        text,
  target_table  text,
  target_id     uuid,
  occurred_at   timestamptz,
  payload       jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  with me as (
    select care_provider_id, provider_role
      from public.caregivers
     where id = auth.uid()
  )
  select
    al.id,
    al.actor_id,
    c.full_name as actor_name,
    al.action,
    al.target_table,
    al.target_id,
    al.occurred_at,
    al.payload
    from public.audit_log al
    left join public.caregivers c on c.id = al.actor_id
    cross join me
   where me.provider_role = 'admin'
     and me.care_provider_id is not null
     and (al.payload->>'audit_provider_id')::uuid = me.care_provider_id
   order by al.occurred_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.get_provider_audit_log(int) from public;
grant execute on function public.get_provider_audit_log(int) to authenticated;
