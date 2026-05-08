-- F10: write policies on `devices`. Reads were scoped in the foundation
-- migration; F10 ships the inserts/updates/deletes scoped to allocated
-- caregivers.
--
-- The two-clause `using` / `with check` shape on the update policy is the
-- "claim-but-don't-steal" pattern (CROSS_CUTTING §1):
--   - `using` is the pre-update row check — permits update only if the row
--     is currently unpaired OR paired to one of my patients.
--   - `with check` is the post-update row check — requires the result row
--     to be unpaired OR paired to one of my patients.
--
-- Together: I can claim an unpaired device, repaint my own device's label,
-- or unpair my own device. I cannot steal a peer's paired device by
-- overwriting `paired_patient_id`.

create policy devices_allocated_insert on public.devices
  for insert with check (
    paired_patient_id is not null
    and public.is_caregiver_for(paired_patient_id)
  );

create policy devices_allocated_update on public.devices
  for update using (
    paired_patient_id is null
    or public.is_caregiver_for(paired_patient_id)
  )
  with check (
    paired_patient_id is null
    or public.is_caregiver_for(paired_patient_id)
  );

create policy devices_allocated_delete on public.devices
  for delete using (public.is_caregiver_for(paired_patient_id));
