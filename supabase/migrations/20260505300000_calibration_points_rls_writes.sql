-- F7: write policies on `calibration_points`. Reads were scoped in the
-- foundation migration via a join through `floor_plans`; F7 adds
-- insert/update/delete using the same join because calibration_points
-- doesn't carry patient_id directly. Same `is_caregiver_for(...)`
-- predicate F5 / F6 use, just one join hop further.

create policy calibration_points_allocated_insert on public.calibration_points
  for insert with check (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.is_caregiver_for(fp.patient_id)
    )
  );

create policy calibration_points_allocated_update on public.calibration_points
  for update using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.is_caregiver_for(fp.patient_id)
    )
  ) with check (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.is_caregiver_for(fp.patient_id)
    )
  );

create policy calibration_points_allocated_delete on public.calibration_points
  for delete using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.is_caregiver_for(fp.patient_id)
    )
  );
