-- Item 86: close peer caregiver email + company_name to in-tenant read.
--
-- caregivers_self_or_peer_read (introduced in 20260507104000) let any
-- caregiver in a tenant read every peer's full row — email,
-- company_name, provider_role, care_provider_id. RLS doesn't filter
-- columns; the only minimum-leakage path is to restrict the table to
-- self-only and expose a SECURITY DEFINER RPC that returns just the
-- peer-readable columns (id, full_name, provider_role).
--
-- The "Members" section in ProviderSettingsPage and any peer-listing
-- surface (CaregiversTab, future audit-log feed) must call
-- get_caregiver_directory() instead of selecting from the table.
--
-- Rollback: drop function get_caregiver_directory(); drop policy
-- caregivers_self_read on caregivers; create policy
-- caregivers_self_or_peer_read with the original predicate from
-- 20260507104000.

drop policy if exists caregivers_self_or_peer_read on public.caregivers;

create policy caregivers_self_read on public.caregivers
  for select using (id = auth.uid());

create or replace function public.get_caregiver_directory()
returns table(id uuid, full_name text, provider_role public.caregiver_provider_role)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, c.full_name, c.provider_role
    from public.caregivers c
   where c.care_provider_id = (
     select care_provider_id from public.caregivers where id = auth.uid()
   )
   order by c.full_name nulls last;
$$;

revoke all on function public.get_caregiver_directory() from public;
grant execute on function public.get_caregiver_directory() to authenticated;
