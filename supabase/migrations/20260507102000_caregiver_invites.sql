-- Phase B step 3: caregiver invites.
--
-- Admin-issued tokens (base64, 24 random bytes, 7-day default expiry).
-- Recipient redeems via accept_invite(token) RPC (in 20260507105000).
--
-- Reads/writes are admin-only — recipients never query this table
-- directly. The accept_invite RPC is SECURITY DEFINER and looks up by
-- token internally, bypassing RLS. That keeps the recipient surface
-- closed: no enumeration, no cross-provider information leak.

create table public.caregiver_invites (
  id uuid primary key default gen_random_uuid(),
  care_provider_id uuid not null references public.care_providers(id) on delete cascade,
  email text not null,
  role public.caregiver_provider_role not null default 'member',
  token text unique not null default encode(extensions.gen_random_bytes(24), 'base64'),
  invited_by uuid not null references public.caregivers(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index caregiver_invites_provider_idx
  on public.caregiver_invites(care_provider_id);
create index caregiver_invites_email_idx
  on public.caregiver_invites(lower(email));

alter table public.caregiver_invites enable row level security;

create policy caregiver_invites_admin_read on public.caregiver_invites
  for select using (public.is_provider_admin(care_provider_id));

create policy caregiver_invites_admin_insert on public.caregiver_invites
  for insert with check (public.is_provider_admin(care_provider_id));

create policy caregiver_invites_admin_update on public.caregiver_invites
  for update using (public.is_provider_admin(care_provider_id))
  with check (public.is_provider_admin(care_provider_id));

create policy caregiver_invites_admin_delete on public.caregiver_invites
  for delete using (public.is_provider_admin(care_provider_id));
