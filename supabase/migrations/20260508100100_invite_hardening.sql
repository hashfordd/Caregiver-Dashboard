-- Items 103 + 111 + 112: invite_caregiver TOCTOU + rate limit + accept_invite
-- null-email guard.
--
--  • #103 — the existence-check + INSERT in invite_caregiver were not
--    atomic; concurrent admin clicks for the same email both passed and
--    both inserted. Recipient redeemed one; the other lingered as a
--    second active invite that survived a Revoke on the "current" one.
--    Fixed by an advisory lock keyed on (provider_id, lower(email))
--    held for the transaction.
--  • #111 — no per-caller rate limit. A compromised admin token could
--    issue unbounded tokens; varying email forms (victim+1@, victim+2@)
--    bypassed the active-invite dedupe. Added a 50-per-hour per-provider
--    cap.
--  • #112 — accept_invite compared lower(invite.email) <> lower(
--    auth.users.email) without checking that auth.users.email is
--    non-null first. For OAuth/phone-OTP users with no email, NULL
--    propagated through the comparison and Postgres treated NULL as
--    not-true → check bypassed → any auth'd user could redeem someone
--    else's invite. Today the project ships email/password + magic-link
--    only; latent.
--
-- Rollback: re-create the prior invite_caregiver + accept_invite
-- function bodies from 20260507105000_provider_invite_rpcs.sql.

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
  v_recent_count integer;
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

  -- #111: per-provider rate limit. 50 invites in any rolling hour is
  -- well above any real onboarding wave; below it scripted abuse.
  select count(*) into v_recent_count
    from public.caregiver_invites
   where care_provider_id = v_provider
     and created_at > now() - interval '1 hour';
  if v_recent_count >= 50 then
    raise exception 'invite_rate_limit_exceeded';
  end if;

  -- #103: serialise concurrent invites for the same (provider, email)
  -- pair so the existence check + INSERT are atomic. Lock auto-releases
  -- at end of transaction.
  perform pg_advisory_xact_lock(hashtext(v_provider::text || ':' || lower(trim(p_email))));

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

  -- #112: callers without an email (OAuth/phone-OTP) cannot accept an
  -- invite — the invite is keyed on email, and a NULL <> 'foo@bar' is
  -- NULL which Postgres treats as not-true, silently bypassing the
  -- email-mismatch guard.
  if v_caller_email is null then
    raise exception 'caller has no email — set one before accepting an invite';
  end if;

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
