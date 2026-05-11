-- Fix · caregivers_block_privileged_self_update blocks service_role too
--
-- The Phase I.A trigger (20260508100000) prevents any UPDATE of
-- provider_role / care_provider_id outside the
-- alzcare.role_change_authorized session bypass. That's correct for
-- regular authenticated callers (anon / authenticated roles can't
-- self-promote), but Supabase service-role keys are already trusted
-- to bypass RLS, and several admin paths — including CI test setups
-- and the future bridge admin tooling — need to bind caregivers to a
-- provider without juggling the session var.
--
-- Adding `current_user = 'service_role'` to the bypass keeps the
-- security model consistent with the RLS model: service-role is the
-- escape hatch for trusted backend code.
--
-- Rollback: drop trigger + recreate the function with the original
-- predicate from 20260508100000.

create or replace function public.caregivers_block_privileged_self_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.id is distinct from new.id then
    raise exception 'caregivers.id is immutable';
  end if;

  if (old.provider_role is distinct from new.provider_role
      or old.care_provider_id is distinct from new.care_provider_id)
     and current_setting('alzcare.role_change_authorized', true) is distinct from 'true'
     and current_user <> 'service_role'
  then
    raise exception 'caregivers.provider_role and care_provider_id may only be changed via set_caregiver_role';
  end if;

  return new;
end;
$$;
