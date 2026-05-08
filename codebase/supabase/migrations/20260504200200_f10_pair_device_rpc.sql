-- F10: SECURITY DEFINER RPC that handles the four pair-device outcomes
-- atomically: insert-new, update-unpaired, no-op-already-mine, reject-pair-
-- elsewhere. Closes the lookup-then-update race window and centralises the
-- "allocated to patient" authorisation check.

create or replace function public.pair_device(
  p_mac_address text,
  p_patient_id uuid,
  p_label text default null
) returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  existing public.devices;
  result public.devices;
begin
  if caller is null then
    raise exception 'auth required';
  end if;
  if not public.is_caregiver_for(p_patient_id) then
    raise exception 'not allocated to patient';
  end if;
  if p_mac_address is null or length(trim(p_mac_address)) = 0 then
    raise exception 'mac_address required';
  end if;

  select * into existing
    from public.devices
    where mac_address = lower(p_mac_address)
    for update;

  if existing.id is null then
    insert into public.devices (mac_address, paired_patient_id, label)
    values (lower(p_mac_address), p_patient_id, p_label)
    returning * into result;
    return result;
  end if;

  if existing.paired_patient_id is not null
     and existing.paired_patient_id <> p_patient_id then
    raise exception 'device already paired to another patient'
      using errcode = 'P0001';
  end if;

  update public.devices
    set paired_patient_id = p_patient_id,
        label = coalesce(p_label, label)
    where id = existing.id
    returning * into result;
  return result;
end;
$$;

revoke all on function public.pair_device(text, uuid, text) from public, anon;
grant execute on function public.pair_device(text, uuid, text) to authenticated;
