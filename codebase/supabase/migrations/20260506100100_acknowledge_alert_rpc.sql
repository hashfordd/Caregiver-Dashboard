-- F11 / F12: acknowledge_alert RPC.
--
-- Why an RPC instead of a direct UPDATE policy: column-level RLS for
-- "you can update acknowledged_at and ack_by_caregiver_id but not
-- severity/context" is brittle (PostgreSQL applies UPDATE RLS at the
-- row level, not the column level — caregivers would either get to
-- update everything or nothing). A SECURITY DEFINER RPC scoped to
-- exactly the ack columns is the cleaner contract.
--
-- Idempotent: a second ack returns the same row unchanged. F12's
-- AckButton uses optimistic UI; the idempotent path means double-clicks
-- and cross-tab races converge cleanly.

create or replace function public.acknowledge_alert(p_alert_id uuid)
returns public.alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.alerts;
begin
  select * into v_row from public.alerts where id = p_alert_id;
  if not found then
    raise exception 'alert not found' using errcode = 'P0002';
  end if;
  if not public.is_caregiver_for(v_row.patient_id) then
    raise exception 'not allocated to patient' using errcode = '42501';
  end if;
  if v_row.acknowledged_at is not null then
    return v_row; -- idempotent: already acked
  end if;
  update public.alerts
    set acknowledged_at = now(),
        ack_by_caregiver_id = auth.uid()
   where id = p_alert_id
   returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.acknowledge_alert(uuid) from public;
grant execute on function public.acknowledge_alert(uuid) to authenticated;
