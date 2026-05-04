-- F1: SECURITY DEFINER RPC that creates a patient and allocates the caller in
-- a single transaction. Closes the half-allocated state that a client-side
-- two-step (insert patient → insert caregiver_patient) is exposed to on
-- network drop or RLS surprise. Centralises the "creator gets allocated"
-- business rule.

create or replace function public.create_patient_with_allocation(
  p_full_name text,
  p_dob date default null,
  p_notes text default null
) returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare
  new_patient public.patients;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'auth required';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full_name required';
  end if;

  insert into public.patients (full_name, dob, notes, primary_caregiver_id)
  values (p_full_name, p_dob, p_notes, caller)
  returning * into new_patient;

  insert into public.caregiver_patient (caregiver_id, patient_id, role)
  values (caller, new_patient.id, 'creator');

  return new_patient;
end;
$$;

revoke all on function public.create_patient_with_allocation(text, date, text) from public;
grant execute on function public.create_patient_with_allocation(text, date, text) to authenticated;
