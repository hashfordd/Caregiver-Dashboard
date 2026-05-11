-- ============================================================================
-- Phase II demo · Anna / Priya / Marcus (data migration)
-- ============================================================================
--
-- Companion to 20260511000000_demo_peer_accounts.sql. Mirrors the
-- $members$ block in supabase/seed.sql so the multi-user test suite has
-- a guaranteed seeded member (Anna) and a second admin (Marcus) to
-- exercise role-gated and allocation-scoped behaviour against, without
-- needing a manual Studio paste.
--
--   Anna     anna+demo@bizzieapp.com    member · Eve + Grace
--   Priya    priya+demo@bizzieapp.com   member · Frank + Henry
--   Marcus   marcus+demo@bizzieapp.com  admin  · sees everyone
--
-- Password: demo1234! (changeable via /profile after first login).
--
-- Idempotent — guarded by `if not exists` (auth.users) and
-- `on conflict do nothing` (caregiver_patient).
-- ============================================================================

do $migration_members$
declare
  v_provider_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_anna_id     uuid := '12121212-1212-1212-1212-121212121212';
  v_priya_id    uuid := '13131313-1313-1313-1313-131313131313';
  v_marcus_id   uuid := '14141414-1414-1414-1414-141414141414';
  v_eve_id      uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_frank_id    uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_grace_id    uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_henry_id    uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
begin
  if not exists (select 1 from public.care_providers where id = v_provider_id) then
    raise notice
      'Acme Care Co provider not present yet. Run supabase/seed.sql via the Studio SQL editor first.';
    return;
  end if;

  -- Anna (member, allocated to Eve + Grace)
  if not exists (select 1 from auth.users where id = v_anna_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_anna_id,
      'authenticated', 'authenticated',
      'anna+demo@bizzieapp.com',
      extensions.crypt('demo1234!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Anna Lee","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Priya (member, allocated to Frank + Henry)
  if not exists (select 1 from auth.users where id = v_priya_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_priya_id,
      'authenticated', 'authenticated',
      'priya+demo@bizzieapp.com',
      extensions.crypt('demo1234!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Priya Singh","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Marcus (admin)
  if not exists (select 1 from auth.users where id = v_marcus_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_marcus_id,
      'authenticated', 'authenticated',
      'marcus+demo@bizzieapp.com',
      extensions.crypt('demo1234!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Marcus Chen","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Bind tenant + role via trigger bypass.
  perform set_config('alzcare.role_change_authorized', 'true', true);

  update public.caregivers
     set care_provider_id = v_provider_id,
         provider_role    = case when id = v_marcus_id
                                  then 'admin'::public.caregiver_provider_role
                                 else 'member'::public.caregiver_provider_role end,
         company_name     = coalesce(company_name, 'Acme Care Co')
   where id in (v_anna_id, v_priya_id, v_marcus_id);

  -- Member allocations (Marcus is an admin so RLS already grants
  -- tenant-wide access; the explicit rows make him appear on each
  -- patient's Caregivers tab).
  insert into public.caregiver_patient (caregiver_id, patient_id) values
    (v_anna_id,   v_eve_id),    (v_anna_id,   v_grace_id),
    (v_priya_id,  v_frank_id),  (v_priya_id,  v_henry_id),
    (v_marcus_id, v_eve_id),    (v_marcus_id, v_frank_id),
    (v_marcus_id, v_grace_id),  (v_marcus_id, v_henry_id)
  on conflict (caregiver_id, patient_id) do nothing;
end
$migration_members$;
