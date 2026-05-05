-- F6: write policies on `beacons`. Reads were scoped in the foundation
-- migration; F6 adds insert/update/delete scoped via is_caregiver_for.

create policy beacons_allocated_insert on public.beacons
  for insert with check (public.is_caregiver_for(patient_id));

create policy beacons_allocated_update on public.beacons
  for update using (public.is_caregiver_for(patient_id))
  with check (public.is_caregiver_for(patient_id));

create policy beacons_allocated_delete on public.beacons
  for delete using (public.is_caregiver_for(patient_id));
