-- Fix · create_care_provider trips caregivers_block_privileged_self_update
--
-- create_care_provider (20260507105000) does an UPDATE on caregivers to
-- bind the caller as admin of the new provider. The protection trigger
-- caregivers_block_privileged_self_update (20260508100000, Phase I.A)
-- was added afterwards and refuses any UPDATE of provider_role or
-- care_provider_id outside the alzcare.role_change_authorized session
-- bypass. The RPC never set that bypass, so first-time provider
-- bootstrap raised every time — silently for hosted users who had
-- already bootstrapped, but catastrophically for CI's fresh
-- supabase start stack.
--
-- Same bypass pattern that set_caregiver_role uses: set the local
-- config inside the security-definer function, then run the
-- privileged UPDATE.

create or replace function public.create_care_provider(p_name text)
returns public.care_providers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_existing uuid;
  v_provider public.care_providers;
begin
  if v_caller is null then
    raise exception 'auth required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name required';
  end if;

  select care_provider_id into v_existing
    from public.caregivers where id = v_caller;

  if v_existing is not null then
    raise exception 'caller already belongs to a care provider';
  end if;

  insert into public.care_providers (name) values (trim(p_name)) returning * into v_provider;

  -- Authorise the BEFORE UPDATE trigger for this transaction so the
  -- first-time tenant bind below passes the privileged-column guard.
  perform set_config('alzcare.role_change_authorized', 'true', true);

  update public.caregivers
     set care_provider_id = v_provider.id,
         provider_role = 'admin'
   where id = v_caller;

  return v_provider;
end;
$$;
