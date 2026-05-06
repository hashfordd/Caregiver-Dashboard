-- F11 / Phase 4: events table.
--
-- Persistence target for `EventMessage` payloads (fall, button_press,
-- low_battery, connect, disconnect, enrollment) the bridge currently
-- validates but doesn't store. The fall rule type reads from this
-- table; operational events (connect/disconnect) live here too so a
-- future audit / device-health view can read a single source.
--
-- Scoped reads via is_caregiver_for; writes are service-role only
-- (the bridge inserts after validating the MQTT payload).

create table public.events (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  occurred_at timestamptz not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_patient_occurred_idx
  on public.events(patient_id, occurred_at desc);

create index events_patient_type_occurred_idx
  on public.events(patient_id, type, occurred_at desc);

alter table public.events enable row level security;

create policy events_allocated_read on public.events
  for select using (public.is_caregiver_for(patient_id));

-- No insert/update/delete policy → RLS denies authenticated callers;
-- the bridge writes via the service role and bypasses RLS.

alter publication supabase_realtime add table public.events;
