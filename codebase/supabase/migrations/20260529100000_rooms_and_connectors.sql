-- Phase B: rooms and room_connectors as first-class entities.
--
-- Until this migration, walls / rooms / furniture all lived as opaque
-- Fabric output in `floor_plans.canvas_json`. That's fine for rendering
-- and decoration, but it means the rules engine cannot ask "which room
-- contains this position?" or "is the patient within N metres of a door?".
-- The rooms + room_connectors tables make those queries addressable so
-- alerts like "patient left bedroom" and "patient near front door" can
-- be expressed in caregiver language instead of raw polygon math against
-- decoration that may shift on every save.
--
-- Schema choices:
--   - Rooms are polygons in canvas-pixel coordinates (same coordinate
--     space as beacons.x_canvas / position_estimates.x_canvas) so
--     point-in-polygon tests run against position estimates without
--     unit conversion.
--   - Connectors (doors / windows / openings) are line segments anchored
--     by their two endpoints. Each connector optionally records the two
--     rooms it joins, but both sides are nullable to allow exterior
--     openings that don't connect two interior rooms (front door).
--   - `patient_id` is denormalised on both tables for cheap RLS — mirrors
--     beacons / calibration_points which do the same. Floor plans only
--     belong to one patient, so the denormalised value can't drift.
--   - Polygon shape is enforced at write time: the JSONB array must have
--     ≥ 3 entries. Geometric validity (self-intersection, winding order)
--     is the rules engine's problem — it should reject malformed
--     polygons gracefully at evaluate time.
--
-- RLS: caregiver-allocated reads + writes via the existing
-- `is_caregiver_for(patient_id)` helper, matching floor_plans / beacons.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  name text not null,
  room_type text not null default 'other',
  polygon_canvas jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_room_type_check check (
    room_type in ('bedroom','bathroom','kitchen','living_room','dining_room','hallway','other')
  ),
  constraint rooms_polygon_min_vertices check (
    jsonb_typeof(polygon_canvas) = 'array' and jsonb_array_length(polygon_canvas) >= 3
  )
);
create index rooms_floor_plan_idx on public.rooms(floor_plan_id);
create index rooms_patient_idx on public.rooms(patient_id);

create table public.room_connectors (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  kind text not null,
  start_x numeric not null,
  start_y numeric not null,
  end_x numeric not null,
  end_y numeric not null,
  room_a_id uuid references public.rooms(id) on delete set null,
  room_b_id uuid references public.rooms(id) on delete set null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_connectors_kind_check check (kind in ('door','window','opening')),
  -- A connector with coincident endpoints is geometrically meaningless
  -- (zero-length segment). Reject at write time.
  constraint room_connectors_endpoints_distinct check (
    start_x <> end_x or start_y <> end_y
  )
);
create index room_connectors_floor_plan_idx on public.room_connectors(floor_plan_id);
create index room_connectors_patient_idx on public.room_connectors(patient_id);
create index room_connectors_kind_idx on public.room_connectors(floor_plan_id, kind);

-- ─── updated_at bump triggers ─────────────────────────────────────────
-- Single shared trigger function so future tables can reuse it. The
-- naming `set_updated_at` matches existing housekeeping triggers.

create or replace function public.rooms_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.rooms_set_updated_at();

create trigger room_connectors_set_updated_at
  before update on public.room_connectors
  for each row execute function public.rooms_set_updated_at();

-- ─── Row-level security ───────────────────────────────────────────────

alter table public.rooms             enable row level security;
alter table public.room_connectors   enable row level security;

create policy rooms_allocated_read on public.rooms
  for select using (public.is_caregiver_for(patient_id));
create policy rooms_allocated_insert on public.rooms
  for insert with check (public.is_caregiver_for(patient_id));
create policy rooms_allocated_update on public.rooms
  for update using (public.is_caregiver_for(patient_id))
  with check (public.is_caregiver_for(patient_id));
create policy rooms_allocated_delete on public.rooms
  for delete using (public.is_caregiver_for(patient_id));

create policy room_connectors_allocated_read on public.room_connectors
  for select using (public.is_caregiver_for(patient_id));
create policy room_connectors_allocated_insert on public.room_connectors
  for insert with check (public.is_caregiver_for(patient_id));
create policy room_connectors_allocated_update on public.room_connectors
  for update using (public.is_caregiver_for(patient_id))
  with check (public.is_caregiver_for(patient_id));
create policy room_connectors_allocated_delete on public.room_connectors
  for delete using (public.is_caregiver_for(patient_id));

comment on table public.rooms is
  'Addressable polygons in canvas-pixel space. Used by the rules engine '
  'to express alerts in caregiver language (entered X, left Y). Decoration '
  'walls/furniture remain in floor_plans.canvas_json.';
comment on table public.room_connectors is
  'Door / window / opening line segments connecting rooms. Used by the '
  'rules engine for "approaching the door" / "passing through" semantics.';
