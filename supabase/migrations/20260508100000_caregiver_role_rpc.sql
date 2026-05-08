-- Items 79 + 80 + 83: lock down the caregivers self-update RLS surface.
--
-- Before this migration, caregivers_self_update (init.sql:224) allowed any
-- logged-in caregiver to UPDATE their own row including provider_role and
-- care_provider_id — i.e. self-promote to admin or rebind to another
-- tenant. Audit-log trail recorded the change but didn't prevent it. The
-- frontend UPDATE in useUpdateMemberRole was also a silent no-op for peer
-- rows because RLS filtered the row out without raising.
--
-- Approach:
--  • Replace caregivers_self_update with the column-scoped predicate plus
--    a BEFORE UPDATE trigger that raises if privileged columns
--    (provider_role, care_provider_id, id) change outside of a
--    SECURITY DEFINER context that has set
--    `alzcare.role_change_authorized = 'true'` for the duration of the
--    transaction.
--  • Promote/demote / tenant-bind goes through set_caregiver_role(), a
--    SECURITY DEFINER RPC that requires admin of the same tenant and
--    refuses demoting the last admin.
--
-- Rollback: drop trigger caregivers_block_privileged_self_update on
-- caregivers; drop function caregivers_block_privileged_self_update();
-- drop function set_caregiver_role(uuid, caregiver_provider_role);
-- drop policy caregivers_self_profile_update on caregivers;
-- create policy caregivers_self_update on caregivers for update
--   using (id = auth.uid()) with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- Replace the catch-all self-update policy.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists caregivers_self_update on public.caregivers;

create policy caregivers_self_profile_update on public.caregivers
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- BEFORE UPDATE trigger that blocks privileged-column changes outside
-- the authorised context.
-- ─────────────────────────────────────────────────────────────────────────
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
  then
    raise exception 'caregivers.provider_role and care_provider_id may only be changed via set_caregiver_role';
  end if;

  return new;
end;
$$;

drop trigger if exists caregivers_block_privileged_self_update on public.caregivers;
create trigger caregivers_block_privileged_self_update
  before update on public.caregivers
  for each row execute function public.caregivers_block_privileged_self_update();

-- ─────────────────────────────────────────────────────────────────────────
-- set_caregiver_role: admin-of-same-tenant changes a peer's role with
-- a guard against demoting the last admin in the tenant.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.set_caregiver_role(
  p_target_id uuid,
  p_role public.caregiver_provider_role
) returns public.caregivers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_provider uuid;
  v_target_provider uuid;
  v_current_role public.caregiver_provider_role;
  v_admin_count integer;
  v_target public.caregivers;
begin
  if v_caller is null then
    raise exception 'auth required';
  end if;

  select care_provider_id into v_caller_provider from public.caregivers where id = v_caller;
  if v_caller_provider is null then
    raise exception 'caller has no provider';
  end if;

  if not public.is_provider_admin(v_caller_provider) then
    raise exception 'forbidden';
  end if;

  select care_provider_id, provider_role into v_target_provider, v_current_role
    from public.caregivers where id = p_target_id;

  if v_target_provider is null or v_target_provider is distinct from v_caller_provider then
    raise exception 'forbidden';
  end if;

  -- Refuse demoting the last admin (catches both self-demote and
  -- admin-demoting-the-only-other-admin paths).
  if v_current_role = 'admin' and p_role = 'member' then
    select count(*) into v_admin_count
      from public.caregivers
     where care_provider_id = v_caller_provider
       and provider_role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'cannot_demote_last_admin';
    end if;
  end if;

  -- Authorise the BEFORE UPDATE trigger for this transaction.
  perform set_config('alzcare.role_change_authorized', 'true', true);

  update public.caregivers
     set provider_role = p_role
   where id = p_target_id
   returning * into v_target;

  return v_target;
end;
$$;

revoke all on function public.set_caregiver_role(uuid, public.caregiver_provider_role) from public;
grant execute on function public.set_caregiver_role(uuid, public.caregiver_provider_role) to authenticated;
