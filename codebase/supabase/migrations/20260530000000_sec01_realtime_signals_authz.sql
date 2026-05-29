-- SEC-01: authorize the patient:<id>:signals realtime broadcast channel.
--
-- Until now the live RSSI/telemetry broadcast channel relied on topic
-- name-spacing as its only access boundary: any authenticated caregiver
-- could `supabase.channel('patient:<any-id>:signals').subscribe()` and
-- receive another patient's live signals, bypassing the RLS that protects
-- the underlying tables. Supabase Realtime Authorization (now GA) closes
-- this by enforcing RLS on realtime.messages for channels opened as
-- `private`.
--
-- Pairing change (same PR): the dashboard (usePatientStream) and the
-- mqtt_bridge now open the signals channel with `{ config: { private:
-- true } }`. Public channels never consult realtime.messages RLS, so this
-- policy only affects the now-private signals channel and leaves the
-- postgres_changes channels (patient:<id>, alerts:*, dashboard:*, the
-- caregiver_patient watcher) completely untouched.
--
-- The bridge writes with the service role, which bypasses RLS, so
-- broadcast *sending* is unaffected; this policy governs who may *receive*.

-- Realtime Authorization requires RLS on realtime.messages. Supabase
-- enables it by default on current projects; assert it idempotently so an
-- older project still gets the protection.
alter table if exists realtime.messages enable row level security;

-- Receive policy: a caregiver may read broadcast messages on a
-- patient:<uuid>:signals topic only for a patient they can access
-- (allocated caregiver OR provider admin in the patient's tenant — the
-- same predicate the table RLS uses). The topic UUID is pulled out with a
-- strict regex so the ::uuid cast can never error on some future
-- non-UUID private topic; a non-match yields NULL → can_access_patient
-- returns false.
drop policy if exists "signals broadcast scoped to accessible patients"
  on realtime.messages;

create policy "signals broadcast scoped to accessible patients"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and public.can_access_patient(
      (regexp_match(realtime.topic(), '^patient:([0-9a-fA-F-]{36}):signals$'))[1]::uuid
    )
  );
