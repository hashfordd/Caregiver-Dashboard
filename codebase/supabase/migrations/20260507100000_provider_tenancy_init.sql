-- Phase B step 1: introduce the care provider tenancy tier above caregivers.
--
-- Until now caregivers have been the unit of tenancy — every per-patient
-- table is RLS-scoped via is_caregiver_for(patient_id). That works for
-- single-caregiver-per-patient family setups but blocks the multi-caregiver
-- agency model the project now requires.
--
-- This migration adds:
--   - care_providers table (the tenant)
--   - caregiver_provider_role enum (admin / member)
--   - care_provider_id columns on caregivers and patients (nullable for now)
--   - the patient column flips to NOT NULL after backfill (20260507103000)
--   - caregivers.care_provider_id stays nullable to accommodate new
--     auth signups before they accept an invite or create their own
--     provider — those users have no provider yet and will see nothing
--     until they bind one.
--
-- Subsequent migrations in this phase:
--   20260507101000  RLS helpers (is_provider_admin, can_access_patient, etc.)
--   20260507102000  caregiver_invites table
--   20260507103000  backfill + invariant trigger + drop primary_caregiver_id
--   20260507104000  RLS policy updates app-wide
--   20260507105000  invite/accept/revoke RPCs
--   20260507106000  patient allocation RPCs
--   20260507107000  updated create_patient_with_allocation
--   20260507108000  drop legacy patients_self_insert / caregiver_patient_self_insert

create type public.caregiver_provider_role as enum ('admin', 'member');

create table public.care_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

alter table public.care_providers enable row level security;

-- Add the columns first so the SELECT policy below can reference them.
alter table public.caregivers
  add column care_provider_id uuid references public.care_providers(id) on delete restrict,
  add column provider_role public.caregiver_provider_role not null default 'member';

create index caregivers_care_provider_id_idx
  on public.caregivers(care_provider_id);

alter table public.patients
  add column care_provider_id uuid references public.care_providers(id) on delete restrict;

create index patients_care_provider_id_idx
  on public.patients(care_provider_id);

-- Self-read: caregivers see their own provider row.
create policy care_providers_member_read on public.care_providers
  for select using (
    exists (
      select 1 from public.caregivers c
      where c.id = auth.uid() and c.care_provider_id = care_providers.id
    )
  );

-- Admin update is added in 20260507104000 once is_provider_admin exists.

comment on column public.caregivers.care_provider_id is
  'Provider tenant. Nullable for new auth signups before they bind to a provider.';
comment on column public.caregivers.provider_role is
  'admin or member within the care provider';
comment on column public.patients.care_provider_id is
  'Provider tenant. NOT NULL after the 20260507103000 backfill.';
