-- Phase B step 8: update create_patient_with_allocation to write
-- care_provider_id from the caller's provider, and refuse if the caller
-- has no provider (they need to create_care_provider or accept_invite
-- first).
--
-- Drops + recreates the F11 version (which had primary_caregiver_id and
-- p_description). primary_caregiver_id was dropped in 20260507103000.

drop function if exists public.create_patient_with_allocation(text, date, text);

create or replace function public.create_patient_with_allocation(
  p_full_name text,
  p_dob date default null,
  p_description text default null
) returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_provider uuid;
  v_patient public.patients;
begin
  if v_caller is null then
    raise exception 'auth required';
  end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full_name required';
  end if;

  select care_provider_id into v_provider from public.caregivers where id = v_caller;
  if v_provider is null then
    raise exception 'caller has no provider — create one or accept an invite first';
  end if;

  insert into public.patients (full_name, dob, description, care_provider_id)
  values (p_full_name, p_dob, p_description, v_provider)
  returning * into v_patient;

  insert into public.caregiver_patient (caregiver_id, patient_id, role)
  values (v_caller, v_patient.id, 'creator');

  return v_patient;
end;
$$;

revoke all on function public.create_patient_with_allocation(text, date, text) from public;
grant execute on function public.create_patient_with_allocation(text, date, text) to authenticated;
