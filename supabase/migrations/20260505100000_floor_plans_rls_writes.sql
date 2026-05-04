-- F5: write policies on `floor_plans`. Reads were scoped in the foundation
-- migration; F5 adds insert/update/delete scoped via is_caregiver_for.

create policy floor_plans_allocated_insert on public.floor_plans
  for insert with check (public.is_caregiver_for(patient_id));

create policy floor_plans_allocated_update on public.floor_plans
  for update using (public.is_caregiver_for(patient_id))
  with check (public.is_caregiver_for(patient_id));

create policy floor_plans_allocated_delete on public.floor_plans
  for delete using (public.is_caregiver_for(patient_id));
