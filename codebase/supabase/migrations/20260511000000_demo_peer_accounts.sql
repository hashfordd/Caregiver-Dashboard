-- ============================================================================
-- Phase II demo · project peer accounts (data migration)
-- ============================================================================
--
-- supabase/seed.sql carries the canonical demo content but only runs when
-- pasted into the Studio SQL editor. The four project peers needed to
-- arrive on the hosted DB via `supabase db push --linked`, so this
-- migration mirrors the seed.sql `$peers$` block: creates the auth.users
-- rows if missing, then binds them all as admins of Acme Care Co with
-- full patient allocation.
--
-- Idempotent — every insert is guarded by `if not exists` (auth.users)
-- or `on conflict do nothing` (caregiver_patient). Re-running is safe.
-- ============================================================================

do $migration_peers$
declare
  v_provider_id  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_olivia_id    uuid := '15151515-1515-1515-1515-151515151515';
  v_mohamed_id   uuid := '16161616-1616-1616-1616-161616161616';
  v_noor_id      uuid := '17171717-1717-1717-1717-171717171717';
  v_hongting_id  uuid := '18181818-1818-1818-1818-181818181818';
  v_eve_id       uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_frank_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_grace_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_henry_id     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
begin
  -- Bail loudly if the care_providers row hasn't been created yet
  -- (i.e. the user hasn't run the core seed via Studio). The peers
  -- need a tenant to attach to.
  if not exists (select 1 from public.care_providers where id = v_provider_id) then
    raise notice
      'Acme Care Co provider not present yet. Run supabase/seed.sql via the Studio SQL editor first to bootstrap the tenant, then re-run db push.';
    return;
  end if;

  -- Olivia
  if not exists (select 1 from auth.users where id = v_olivia_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_olivia_id,
      'authenticated', 'authenticated',
      '103642997@student.swin.edu.au',
      extensions.crypt('demo1234!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Olivia","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Mohamed
  if not exists (select 1 from auth.users where id = v_mohamed_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_mohamed_id,
      'authenticated', 'authenticated',
      '104341981@student.swin.edu.au',
      extensions.crypt('demo1234!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Mohamed","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Noor
  if not exists (select 1 from auth.users where id = v_noor_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_noor_id,
      'authenticated', 'authenticated',
      '104171926@student.swin.edu.au',
      extensions.crypt('demo1234!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Noor","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Hongting
  if not exists (select 1 from auth.users where id = v_hongting_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_hongting_id,
      'authenticated', 'authenticated',
      '105961089@student.swin.edu.au',
      extensions.crypt('demo1234!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Hongting","role":"professional","company_name":"Acme Care Co"}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  -- Bind tenant + admin role via the documented trigger bypass.
  perform set_config('alzcare.role_change_authorized', 'true', true);

  update public.caregivers
     set care_provider_id = v_provider_id,
         provider_role    = 'admin'::public.caregiver_provider_role,
         company_name     = coalesce(company_name, 'Acme Care Co')
   where id in (v_olivia_id, v_mohamed_id, v_noor_id, v_hongting_id);

  -- Full allocation set per peer.
  insert into public.caregiver_patient (caregiver_id, patient_id) values
    (v_olivia_id,   v_eve_id), (v_olivia_id,   v_frank_id),
    (v_olivia_id,   v_grace_id), (v_olivia_id, v_henry_id),
    (v_mohamed_id,  v_eve_id), (v_mohamed_id,  v_frank_id),
    (v_mohamed_id,  v_grace_id), (v_mohamed_id, v_henry_id),
    (v_noor_id,     v_eve_id), (v_noor_id,     v_frank_id),
    (v_noor_id,     v_grace_id), (v_noor_id,   v_henry_id),
    (v_hongting_id, v_eve_id), (v_hongting_id, v_frank_id),
    (v_hongting_id, v_grace_id), (v_hongting_id, v_henry_id)
  on conflict (caregiver_id, patient_id) do nothing;
end
$migration_peers$;
