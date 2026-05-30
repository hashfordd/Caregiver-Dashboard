-- ============================================================================
-- Fix: rooms / room_connectors RLS was scoped to is_caregiver_for(patient_id),
-- the legacy direct-allocation-only predicate. Every other floor-plan table
-- (floor_plans, beacons, calibration_points) was upgraded in
-- 20260507104000_provider_admin_rls.sql to can_access_patient(patient_id) =
-- is_caregiver_for(p) OR is_provider_admin(provider_for(p)).
--
-- The rooms/room_connectors migration (20260529100000) landed later but was
-- written against the old helper, so provider admins (who reach the patient via
-- the tenant path, not a direct caregiver_patient row) could read walls + beacons
-- but got ZERO rows from rooms/room_connectors — doors/windows silently vanished
-- for them, and inserts were rejected. Align these two tables with the rest of
-- the floor plan.
-- ============================================================================

-- rooms ----------------------------------------------------------------------
drop policy if exists rooms_allocated_read on public.rooms;
drop policy if exists rooms_allocated_insert on public.rooms;
drop policy if exists rooms_allocated_update on public.rooms;
drop policy if exists rooms_allocated_delete on public.rooms;

create policy rooms_allocated_read
  on public.rooms for select
  using (public.can_access_patient(patient_id));
create policy rooms_allocated_insert
  on public.rooms for insert
  with check (public.can_access_patient(patient_id));
create policy rooms_allocated_update
  on public.rooms for update
  using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id));
create policy rooms_allocated_delete
  on public.rooms for delete
  using (public.can_access_patient(patient_id));

-- room_connectors ------------------------------------------------------------
drop policy if exists room_connectors_allocated_read on public.room_connectors;
drop policy if exists room_connectors_allocated_insert on public.room_connectors;
drop policy if exists room_connectors_allocated_update on public.room_connectors;
drop policy if exists room_connectors_allocated_delete on public.room_connectors;

create policy room_connectors_allocated_read
  on public.room_connectors for select
  using (public.can_access_patient(patient_id));
create policy room_connectors_allocated_insert
  on public.room_connectors for insert
  with check (public.can_access_patient(patient_id));
create policy room_connectors_allocated_update
  on public.room_connectors for update
  using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id));
create policy room_connectors_allocated_delete
  on public.room_connectors for delete
  using (public.can_access_patient(patient_id));
