-- Phase B step 9: drop the legacy self-insert policies.
--
-- patients_self_insert allowed direct INSERT with primary_caregiver_id
-- = auth.uid(). Both the column and the policy are obsolete: column
-- dropped in 20260507103000, allocation now goes through
-- create_patient_with_allocation (RPC, SECURITY DEFINER).
--
-- caregiver_patient_self_insert allowed a caregiver to add themselves
-- OR add a peer to a patient they were already allocated to. With the
-- provider tier in place, allocation is admin-only via
-- allocate_patient RPC. The old self-insert is a foot-gun and is
-- dropped here.

drop policy if exists patients_self_insert on public.patients;
drop policy if exists caregiver_patient_self_insert on public.caregiver_patient;
