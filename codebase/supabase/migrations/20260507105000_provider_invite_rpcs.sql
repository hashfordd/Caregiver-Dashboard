-- Phase B step 6: provider lifecycle RPCs.
--
-- create_care_provider(name) — caller has no provider; create one and
--   bind the caller as admin.
-- invite_caregiver(email, role) — admin only; emit a token row.
-- accept_invite(token) — caller authenticated, no provider yet; bind to
--   the invite's provider with the invite's role.
-- revoke_invite(invite_id) — admin only; only if not yet accepted.
--
-- All SECURITY DEFINER + lock down PUBLIC EXECUTE; only authenticated.

-- ─────────────────────────────────────────────────────────────────────────
-- create_care_provider
-- ─────────────────────────────────────────────────────────────────────────
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

  update public.caregivers
     set care_provider_id = v_provider.id,
         provider_role = 'admin'
   where id = v_caller;

  return v_provider;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- invite_caregiver
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.invite_caregiver(
  p_email text,
  p_role public.caregiver_provider_role default 'member'
) returns public.caregiver_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_provider uuid;
  v_invite public.caregiver_invites;
begin
  if v_caller is null then
    raise exception 'auth required';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'email required';
  end if;

  select care_provider_id into v_provider from public.caregivers where id = v_caller;
  if v_provider is null then
    raise exception 'caller has no provider';
  end if;
  if not public.is_provider_admin(v_provider) then
    raise exception 'admin only';
  end if;

  -- Refuse if there's already an active (unaccepted, unexpired) invite
  -- for the same email in this provider.
  if exists (
    select 1 from public.caregiver_invites
    where care_provider_id = v_provider
      and lower(email) = lower(trim(p_email))
      and accepted_at is null
      and expires_at > now()
  ) then
    raise exception 'an active invite for this email already exists';
  end if;

  insert into public.caregiver_invites (care_provider_id, email, role, invited_by)
  values (v_provider, lower(trim(p_email)), p_role, v_caller)
  returning * into v_invite;

  return v_invite;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- accept_invite
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.accept_invite(p_token text)
returns public.caregivers
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_email text;
  v_invite public.caregiver_invites;
  v_caregiver public.caregivers;
begin
  if v_caller is null then
    raise exception 'auth required';
  end if;
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'token required';
  end if;

  select email into v_caller_email from auth.users where id = v_caller;

  -- Lock the invite row to prevent two concurrent accepts.
  select * into v_invite
    from public.caregiver_invites
   where token = p_token
   for update;

  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'invite already accepted';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite expired';
  end if;
  if lower(v_invite.email) <> lower(v_caller_email) then
    raise exception 'invite email mismatch';
  end if;

  -- Caller must not already belong to a provider.
  if exists (
    select 1 from public.caregivers
    where id = v_caller and care_provider_id is not null
  ) then
    raise exception 'caller already belongs to a care provider';
  end if;

  update public.caregivers
     set care_provider_id = v_invite.care_provider_id,
         provider_role = v_invite.role
   where id = v_caller
   returning * into v_caregiver;

  update public.caregiver_invites set accepted_at = now() where id = v_invite.id;

  return v_caregiver;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- revoke_invite
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.caregiver_invites;
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;

  select * into v_invite from public.caregiver_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if not public.is_provider_admin(v_invite.care_provider_id) then
    raise exception 'admin only';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'cannot revoke an accepted invite';
  end if;

  delete from public.caregiver_invites where id = p_invite_id;
end;
$$;

-- Lock down PUBLIC; grant only to authenticated.
revoke all on function public.create_care_provider(text) from public;
revoke all on function public.invite_caregiver(text, public.caregiver_provider_role) from public;
revoke all on function public.accept_invite(text) from public;
revoke all on function public.revoke_invite(uuid) from public;

grant execute on function public.create_care_provider(text) to authenticated;
grant execute on function public.invite_caregiver(text, public.caregiver_provider_role) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
