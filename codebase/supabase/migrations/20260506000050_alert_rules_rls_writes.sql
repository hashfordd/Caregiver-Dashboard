-- F9 / F11: write policies on `alert_rules`. Reads were scoped in the
-- foundation migration. Caregivers allocated to a patient can manage that
-- patient's alert rules — F9 needs this for the geofence draw/save flow,
-- and F11 will reuse it for the rules-engine settings UI.

create policy alert_rules_allocated_insert on public.alert_rules
  for insert with check (public.is_caregiver_for(patient_id));

create policy alert_rules_allocated_update on public.alert_rules
  for update using (public.is_caregiver_for(patient_id))
  with check (public.is_caregiver_for(patient_id));

create policy alert_rules_allocated_delete on public.alert_rules
  for delete using (public.is_caregiver_for(patient_id));

-- Auto-bump updated_at on row changes so the dashboard can detect a
-- caregiver-side edit landing within 30 s (CROSS_CUTTING §10).
create or replace function public.alert_rules_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger alert_rules_set_updated_at_trg
before update on public.alert_rules
for each row execute function public.alert_rules_set_updated_at();
