-- Phase B step 2: RLS helpers for the care-provider tenancy.
--
-- Pattern matches is_caregiver_for from the foundation migration:
-- SECURITY DEFINER + STABLE so they can be inlined in policy predicates
-- and don't pay query-planning cost per row.
--
-- can_access_patient(patient_id) is the universal helper for per-patient
-- tables — caregivers see their allocated patients, provider admins see
-- every patient in their tenant. Use it in every read/write policy that
-- joins on patient_id.

create or replace function public.is_provider_admin(p_provider uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select exists (
    select 1 from public.caregivers
    where id = auth.uid()
      and care_provider_id = p_provider
      and provider_role = 'admin'
  );
$$;

create or replace function public.provider_for_caregiver(p_caregiver uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select care_provider_id from public.caregivers where id = p_caregiver limit 1;
$$;

create or replace function public.is_in_my_provider(p_caregiver uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.caregivers c1
    join public.caregivers c2 on c1.care_provider_id = c2.care_provider_id
    where c1.id = auth.uid()
      and c2.id = p_caregiver
      and c1.care_provider_id is not null
  );
$$;

-- Universal per-patient access predicate: allocated caregiver OR
-- provider admin in the patient's tenant.
create or replace function public.can_access_patient(p_patient_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_caregiver_for(p_patient_id)
      or public.is_provider_admin(
           (select care_provider_id from public.patients where id = p_patient_id)
         );
$$;

-- Lock down execute permissions — these helpers run as SECURITY DEFINER
-- and Postgres grants PUBLIC EXECUTE by default on new functions.
revoke all on function public.is_provider_admin(uuid) from public;
revoke all on function public.provider_for_caregiver(uuid) from public;
revoke all on function public.is_in_my_provider(uuid) from public;
revoke all on function public.can_access_patient(uuid) from public;

grant execute on function public.is_provider_admin(uuid) to authenticated;
grant execute on function public.provider_for_caregiver(uuid) to authenticated;
grant execute on function public.is_in_my_provider(uuid) to authenticated;
grant execute on function public.can_access_patient(uuid) to authenticated;
