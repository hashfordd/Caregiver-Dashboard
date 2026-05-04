-- F1: caregiver write surface.
-- Read-scoping is in the foundation migration. Caregivers self-update is also
-- already declared there, so this migration only adds the write policies for
-- patients and caregiver_patient that F1 introduces.

-- patients ────────────────────────────────────────────────────────────────────

-- Caregiver creates a patient and is auto-allocated as primary caregiver.
-- Two-step path uses the create_patient_with_allocation RPC which runs
-- SECURITY DEFINER and bypasses RLS; this policy supports the rare case of
-- direct insert (e.g. seed scripts running as authenticated test users).
create policy patients_self_insert on public.patients
  for insert with check (primary_caregiver_id = auth.uid());

create policy patients_allocated_update on public.patients
  for update using (public.is_caregiver_for(id))
  with check (public.is_caregiver_for(id));

create policy patients_allocated_delete on public.patients
  for delete using (public.is_caregiver_for(id));

-- caregiver_patient ───────────────────────────────────────────────────────────

-- A caregiver may insert a row that allocates themselves OR may add a peer to
-- a patient they are already allocated to. The first clause covers the
-- creator-auto-allocate case (only true if executed as part of the SECURITY
-- DEFINER RPC where it runs against a freshly-inserted patient); the second
-- supports peer invites once allocation exists.
create policy caregiver_patient_self_insert on public.caregiver_patient
  for insert with check (
    caregiver_id = auth.uid()
    or public.is_caregiver_for(patient_id)
  );

-- A caregiver may remove their own allocation (leave the patient).
-- Removing someone else's allocation is out of scope for V1.
create policy caregiver_patient_self_delete on public.caregiver_patient
  for delete using (caregiver_id = auth.uid());
