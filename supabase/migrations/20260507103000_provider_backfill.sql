-- Phase B step 4: backfill + invariant trigger + drop primary_caregiver_id.
--
-- Rollback (item 146): DATA-LOSSY for the dropped column. To revert:
--   alter table public.patients add column primary_caregiver_id uuid;
--   alter table public.patients alter column care_provider_id drop not null;
--   drop trigger caregiver_patient_invariant on public.caregiver_patient;
--   drop function public.caregiver_patient_invariant();
--   -- The original primary_caregiver_id values cannot be reconstructed
--   -- without a snapshot taken before this migration ran; the backfill
--   -- moved their semantics into caregiver_patient + care_provider_id.
--   -- Restore from backup or accept that primary_caregiver_id is null
--   -- on every patient post-rollback.
--
-- For each existing caregiver with no provider:
--   1. Create a care_providers row using their company_name (fallback
--      'Personal'). One provider per existing caregiver — they're the
--      sole admin until invite + accept lands them peers.
--   2. Set the caregiver's care_provider_id and provider_role = 'admin'.
--
-- For each existing patient with no provider:
--   3. Set patient's care_provider_id from primary_caregiver_id's
--      provider, falling back to the oldest caregiver_patient
--      allocation. Fail loudly if neither exists.
--
-- Once backfill is complete, flip patients.care_provider_id NOT NULL,
-- add the same-provider invariant trigger on caregiver_patient, and
-- drop the now-redundant patients.primary_caregiver_id column
-- (caregiver_patient cardinality replaces it: 1 row = sole assignment,
-- N rows = shared).

do $$
declare
  v_caregiver record;
  v_provider_id uuid;
begin
  for v_caregiver in
    select id, full_name, company_name
    from public.caregivers
    where care_provider_id is null
  loop
    insert into public.care_providers (name)
    values (coalesce(nullif(trim(v_caregiver.company_name), ''), 'Personal'))
    returning id into v_provider_id;

    update public.caregivers
       set care_provider_id = v_provider_id,
           provider_role = 'admin'
     where id = v_caregiver.id;
  end loop;
end $$;

-- Backfill patients via primary_caregiver_id first.
update public.patients p
   set care_provider_id = c.care_provider_id
  from public.caregivers c
 where p.primary_caregiver_id = c.id
   and p.care_provider_id is null
   and c.care_provider_id is not null;

-- Fallback: oldest caregiver_patient allocation.
update public.patients p
   set care_provider_id = c.care_provider_id
  from public.caregiver_patient cp
  join public.caregivers c on c.id = cp.caregiver_id
 where p.id = cp.patient_id
   and p.care_provider_id is null
   and c.care_provider_id is not null
   and cp.granted_at = (
     select min(cp2.granted_at) from public.caregiver_patient cp2 where cp2.patient_id = p.id
   );

-- Verify — fail loudly if anything is unbacked.
do $$
declare
  v_unbacked int;
begin
  select count(*) into v_unbacked from public.patients where care_provider_id is null;
  if v_unbacked > 0 then
    raise exception 'backfill failed: % patient(s) have no care_provider_id', v_unbacked;
  end if;
end $$;

-- Now safe to make patients.care_provider_id NOT NULL. Caregivers stays
-- nullable for new auth signups that haven't bound a provider yet.
alter table public.patients alter column care_provider_id set not null;

-- Same-provider invariant trigger on caregiver_patient. Reject any
-- insert/update where caregiver and patient belong to different
-- provider tenants — this is the load-bearing tenancy guarantee.
create or replace function public.caregiver_patient_invariant()
returns trigger
language plpgsql
as $$
declare
  v_caregiver_provider uuid;
  v_patient_provider uuid;
begin
  select care_provider_id into v_caregiver_provider
    from public.caregivers where id = new.caregiver_id;
  select care_provider_id into v_patient_provider
    from public.patients where id = new.patient_id;

  if v_caregiver_provider is null then
    raise exception 'caregiver_patient invariant: caregiver % has no provider', new.caregiver_id;
  end if;
  if v_patient_provider is null then
    raise exception 'caregiver_patient invariant: patient % has no provider', new.patient_id;
  end if;
  if v_caregiver_provider <> v_patient_provider then
    raise exception 'caregiver_patient invariant: cross-provider allocation forbidden';
  end if;
  return new;
end;
$$;

create trigger caregiver_patient_invariant_check
  before insert or update on public.caregiver_patient
  for each row execute function public.caregiver_patient_invariant();

-- The legacy patients_self_insert policy depends on primary_caregiver_id;
-- drop it (and its caregiver_patient counterpart) here so the column drop
-- below succeeds. Migration 20260507108000 also tries to drop them with
-- `if exists` and is therefore a no-op once this lands.
drop policy if exists patients_self_insert on public.patients;
drop policy if exists caregiver_patient_self_insert on public.caregiver_patient;

-- Drop primary_caregiver_id. caregiver_patient is now the sole source
-- of truth for "who is allocated to this patient" and care_provider_id
-- gives us the tenancy boundary.
alter table public.patients drop column primary_caregiver_id;
