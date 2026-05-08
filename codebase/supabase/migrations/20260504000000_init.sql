-- ============================================================================
-- ENG40011 Caregiver Dashboard · initial schema (V1 prototype)
-- 12 core tables · time-series indexes · RLS stubs · realtime publication
-- ============================================================================

-- Required extensions
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ============================================================================
-- Enums
-- ============================================================================

create type public.caregiver_role as enum ('professional', 'family');
create type public.alert_severity as enum ('info', 'warn', 'critical');
create type public.alert_rule_type as enum (
  'zone',
  'vitals',
  'fall',
  'inactivity',
  'repetitive_movement'
);
create type public.position_mode as enum ('indoor', 'outdoor');

-- ============================================================================
-- Tables
-- ============================================================================

-- 1. caregivers (auth-linked profile)
create table public.caregivers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.caregiver_role not null default 'family',
  created_at timestamptz not null default now()
);

-- 2. patients
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  dob date,
  notes text,
  primary_caregiver_id uuid references public.caregivers(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 3. caregiver_patient (many-to-many allocation)
create table public.caregiver_patient (
  caregiver_id uuid not null references public.caregivers(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  role text,
  granted_at timestamptz not null default now(),
  primary key (caregiver_id, patient_id)
);
create index caregiver_patient_patient_idx on public.caregiver_patient(patient_id);

-- 4. devices (physical wearables)
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  mac_address text not null unique,
  firmware_version text,
  paired_patient_id uuid references public.patients(id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index devices_paired_patient_idx on public.devices(paired_patient_id);

-- 5. floor_plans
create table public.floor_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  canvas_json jsonb not null default '{}'::jsonb,
  scale_meters_per_pixel numeric,
  created_at timestamptz not null default now()
);
create index floor_plans_patient_idx on public.floor_plans(patient_id);

-- 6. beacons (BLE beacons placed in the patient's space)
create table public.beacons (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  floor_plan_id uuid references public.floor_plans(id) on delete set null,
  mac_address text not null,
  x_canvas numeric,
  y_canvas numeric,
  label text,
  tx_power numeric,        -- TODO: F8 / POS-02 — calibrated TX power per beacon
  rssi_at_1m numeric,      -- TODO: F8 / POS-02 — calibrated reference RSSI at 1m
  created_at timestamptz not null default now(),
  unique (patient_id, mac_address)
);
create index beacons_patient_idx on public.beacons(patient_id);

-- 7. calibration_points (captured fingerprints)
create table public.calibration_points (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  x_canvas numeric not null,
  y_canvas numeric not null,
  ble_signature jsonb not null default '[]'::jsonb,
  wifi_signature jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now()
);
create index calibration_points_floor_plan_idx
  on public.calibration_points(floor_plan_id);

-- 8. sensor_readings (time-series telemetry)
create table public.sensor_readings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  recorded_at timestamptz not null,
  hr_bpm numeric,
  spo2_pct numeric,
  temp_c numeric,
  accel jsonb,
  gyro jsonb,
  created_at timestamptz not null default now()
);
create index sensor_readings_patient_recorded_idx
  on public.sensor_readings(patient_id, recorded_at desc);

-- 9. position_estimates (computed positions, time-series)
create table public.position_estimates (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  recorded_at timestamptz not null,
  mode public.position_mode not null,
  x_canvas numeric,
  y_canvas numeric,
  lat numeric,
  lng numeric,
  confidence numeric,
  created_at timestamptz not null default now()
);
create index position_estimates_patient_recorded_idx
  on public.position_estimates(patient_id, recorded_at desc);

-- 10. alert_rules (per-patient configuration)
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  type public.alert_rule_type not null,
  params jsonb not null default '{}'::jsonb,
  severity public.alert_severity not null default 'warn',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index alert_rules_patient_idx on public.alert_rules(patient_id);

-- 11. alerts (fired events)
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  rule_id uuid references public.alert_rules(id) on delete set null,
  severity public.alert_severity not null,
  fired_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  ack_by_caregiver_id uuid references public.caregivers(id) on delete set null,
  context jsonb not null default '{}'::jsonb
);
create index alerts_patient_fired_idx
  on public.alerts(patient_id, fired_at desc);
create index alerts_unacked_idx
  on public.alerts(patient_id) where acknowledged_at is null;

-- 12. audit_log (compliance trail)
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.caregivers(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_log_actor_occurred_idx
  on public.audit_log(actor_id, occurred_at desc);

-- ============================================================================
-- Helper function: is the auth user allocated to a given patient?
-- ============================================================================

create or replace function public.is_caregiver_for(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.caregiver_patient
    where caregiver_id = auth.uid()
      and patient_id = p_patient_id
  );
$$;

-- ============================================================================
-- Row-Level Security
-- TODO: F1 / BE-04 — these are read-scoping stubs. Add write policies, admin
-- override paths, and service-role allowances for ingestion as features land.
-- ============================================================================

alter table public.caregivers          enable row level security;
alter table public.patients            enable row level security;
alter table public.caregiver_patient   enable row level security;
alter table public.devices             enable row level security;
alter table public.beacons             enable row level security;
alter table public.floor_plans         enable row level security;
alter table public.calibration_points  enable row level security;
alter table public.sensor_readings     enable row level security;
alter table public.position_estimates  enable row level security;
alter table public.alert_rules         enable row level security;
alter table public.alerts              enable row level security;
alter table public.audit_log           enable row level security;

-- caregivers: read/update own row
create policy caregivers_self_read on public.caregivers
  for select using (id = auth.uid());
create policy caregivers_self_update on public.caregivers
  for update using (id = auth.uid()) with check (id = auth.uid());

-- caregiver_patient: read own allocations
create policy caregiver_patient_self_read on public.caregiver_patient
  for select using (caregiver_id = auth.uid());

-- patients: read patients allocated to me
create policy patients_allocated_read on public.patients
  for select using (public.is_caregiver_for(id));

-- per-patient resources: scope by caregiver_patient allocation
create policy floor_plans_allocated_read on public.floor_plans
  for select using (public.is_caregiver_for(patient_id));

create policy beacons_allocated_read on public.beacons
  for select using (public.is_caregiver_for(patient_id));

create policy calibration_points_allocated_read on public.calibration_points
  for select using (
    exists (
      select 1 from public.floor_plans fp
      where fp.id = calibration_points.floor_plan_id
        and public.is_caregiver_for(fp.patient_id)
    )
  );

create policy sensor_readings_allocated_read on public.sensor_readings
  for select using (public.is_caregiver_for(patient_id));

create policy position_estimates_allocated_read on public.position_estimates
  for select using (public.is_caregiver_for(patient_id));

create policy alert_rules_allocated_read on public.alert_rules
  for select using (public.is_caregiver_for(patient_id));

create policy alerts_allocated_read on public.alerts
  for select using (public.is_caregiver_for(patient_id));

-- devices: scope via paired patient (unpaired devices are visible to all
-- authenticated callers for the discovery/pairing flow)
create policy devices_allocated_read on public.devices
  for select using (
    paired_patient_id is null
    or public.is_caregiver_for(paired_patient_id)
  );

-- audit_log: TODO: REG-04 / BE-11 — restrict to admin role once defined.
-- For now, no select policy exists, so RLS denies by default.

-- ============================================================================
-- Realtime publication
-- TODO: BE-05 — confirm publication name matches Supabase default
-- (supabase_realtime). If running outside Supabase, create the publication.
-- ============================================================================

alter publication supabase_realtime add table
  public.sensor_readings,
  public.position_estimates,
  public.alerts;

-- ============================================================================
-- Trigger: auto-create caregiver row on auth.users insert
-- TODO: F1 — extend with role + full_name from raw_user_meta_data on signup.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caregivers (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::public.caregiver_role, 'family')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
