-- Phase B step 7: patient allocation RPCs.
--
-- allocate_patient(patient_id, caregiver_id) — admin only; both must
--   belong to the caller's provider; idempotent (no-op if already
--   allocated).
-- unallocate_patient(patient_id, caregiver_id) — admin only; allowed
--   even if it removes the last caregiver, because admins still see the
--   patient via the tenant SELECT policy.

create or replace function public.allocate_patient(
  p_patient_id uuid,
  p_caregiver_id uuid
) returns public.caregiver_patient
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_provider uuid;
  v_target_caregiver_provider uuid;
  v_patient_provider uuid;
  v_existing public.caregiver_patient;
  v_inserted public.caregiver_patient;
begin
  if v_caller is null then
    raise exception 'auth required';
  end if;

  select care_provider_id into v_caller_provider from public.caregivers where id = v_caller;
  if v_caller_provider is null then
    raise exception 'caller has no provider';
  end if;
  if not public.is_provider_admin(v_caller_provider) then
    raise exception 'admin only';
  end if;

  select care_provider_id into v_target_caregiver_provider
    from public.caregivers where id = p_caregiver_id;
  if v_target_caregiver_provider is null or v_target_caregiver_provider <> v_caller_provider then
    raise exception 'target caregiver is not in caller provider';
  end if;

  select care_provider_id into v_patient_provider from public.patients where id = p_patient_id;
  if v_patient_provider is null or v_patient_provider <> v_caller_provider then
    raise exception 'target patient is not in caller provider';
  end if;

  -- Idempotent: return existing row if allocation exists.
  select * into v_existing from public.caregiver_patient
    where caregiver_id = p_caregiver_id and patient_id = p_patient_id;
  if v_existing.caregiver_id is not null then
    return v_existing;
  end if;

  insert into public.caregiver_patient (caregiver_id, patient_id, role)
  values (p_caregiver_id, p_patient_id, 'allocated')
  returning * into v_inserted;

  return v_inserted;
end;
$$;

create or replace function public.unallocate_patient(
  p_patient_id uuid,
  p_caregiver_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_provider uuid;
  v_target_caregiver_provider uuid;
begin
  if v_caller is null then
    raise exception 'auth required';
  end if;

  select care_provider_id into v_caller_provider from public.caregivers where id = v_caller;
  if v_caller_provider is null then
    raise exception 'caller has no provider';
  end if;
  if not public.is_provider_admin(v_caller_provider) then
    raise exception 'admin only';
  end if;

  select care_provider_id into v_target_caregiver_provider
    from public.caregivers where id = p_caregiver_id;
  if v_target_caregiver_provider is null or v_target_caregiver_provider <> v_caller_provider then
    raise exception 'target caregiver is not in caller provider';
  end if;

  delete from public.caregiver_patient
   where caregiver_id = p_caregiver_id and patient_id = p_patient_id;
end;
$$;

revoke all on function public.allocate_patient(uuid, uuid) from public;
revoke all on function public.unallocate_patient(uuid, uuid) from public;

grant execute on function public.allocate_patient(uuid, uuid) to authenticated;
grant execute on function public.unallocate_patient(uuid, uuid) to authenticated;
