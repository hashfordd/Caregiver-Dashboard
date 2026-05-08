-- Phase II.D: unified recent-activity feed for the dashboard.
--
-- get_recent_activity() returns one row per "human-authored" event
-- across incidents + medication_administrations + patient_notes for
-- every patient the caller can access, ordered by recency, capped
-- at 30 rows. The dashboard composes this with the realtime alert
-- stream for a complete picture of "what just happened on the floor".
--
-- The function joins on caregivers to surface the actor's display
-- name. Phase I.A's caregivers_self_read policy hides peer rows
-- from regular SELECTs; SECURITY DEFINER bypasses RLS so the join
-- can resolve every actor in the same tenant without an additional
-- directory RPC.

create or replace function public.get_recent_activity()
returns table (
  activity_id    uuid,
  patient_id     uuid,
  patient_name   text,
  kind           text,
  occurred_at    timestamptz,
  actor_id       uuid,
  actor_name     text,
  summary        text
)
language sql
security definer
stable
set search_path = public
as $$
  with merged as (
    select
      i.id                                                            as activity_id,
      i.patient_id                                                    as patient_id,
      'incident'::text                                                as kind,
      i.occurred_at                                                   as occurred_at,
      i.logged_by                                                     as actor_id,
      format('%s · severity %s · %s',
             i.type::text,
             i.severity::text,
             left(i.description, 100))                                as summary
      from public.incidents i
     where public.can_access_patient(i.patient_id)

    union all

    select
      ma.id                                                           as activity_id,
      m.patient_id                                                    as patient_id,
      'medication'::text                                              as kind,
      coalesce(ma.administered_at, ma.created_at)                     as occurred_at,
      ma.administered_by                                              as actor_id,
      format('%s — %s%s',
             ma.status::text,
             m.name,
             case when m.dose is null then '' else ' (' || m.dose || ')' end)
                                                                       as summary
      from public.medication_administrations ma
      join public.medications m on m.id = ma.medication_id
     where public.can_access_patient(m.patient_id)

    union all

    select
      n.id                                                            as activity_id,
      n.patient_id                                                    as patient_id,
      'note'::text                                                    as kind,
      n.created_at                                                    as occurred_at,
      n.author_caregiver_id                                           as actor_id,
      left(n.body, 140)                                               as summary
      from public.patient_notes n
     where public.can_access_patient(n.patient_id)
  )
  select
    m.activity_id,
    m.patient_id,
    p.full_name                                                       as patient_name,
    m.kind,
    m.occurred_at,
    m.actor_id,
    c.full_name                                                       as actor_name,
    m.summary
    from merged m
    join public.patients p on p.id = m.patient_id
    left join public.caregivers c on c.id = m.actor_id
   order by m.occurred_at desc
   limit 30;
$$;

revoke all on function public.get_recent_activity() from public;
grant execute on function public.get_recent_activity() to authenticated;
