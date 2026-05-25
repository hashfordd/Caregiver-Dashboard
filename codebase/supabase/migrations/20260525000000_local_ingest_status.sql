-- Local-server (bridge) liveness heartbeat.
--
-- The on-prem ingest server (MQTT broker + mqtt_bridge) upserts this row every
-- few seconds. The dashboard reads it to show whether the local server is
-- online and feeding data ("pair the live app to the local server"). Global,
-- not per-patient: one ingest server feeds all the patients it handles.
--
-- Writes are service-role only (the bridge, which bypasses RLS). Any
-- authenticated caregiver can read it.

create table if not exists public.local_ingest_status (
  id               text primary key,           -- server identifier (default 'default')
  last_seen_at     timestamptz not null default now(),
  broker_connected boolean not null default false,
  bridge_version   text,
  updated_at       timestamptz not null default now()
);

alter table public.local_ingest_status enable row level security;

drop policy if exists local_ingest_status_read on public.local_ingest_status;
create policy local_ingest_status_read
  on public.local_ingest_status
  for select
  to authenticated
  using (true);
