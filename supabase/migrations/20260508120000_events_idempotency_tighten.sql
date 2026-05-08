-- Item 109: tighten events idempotency to also cover device-less events.
--
-- The Phase G item-65 partial unique index excluded NULL device_id rows
-- (`where device_id is not null`) which is the standard partial-unique
-- pattern for "only when the column is non-null". But the bridge's
-- EventMessage schema does permit a NULL device_id (e.g. operational
-- events that don't tie to a specific wearable, or paths where device
-- resolution failed). For those rows, webhook retries inserted
-- duplicates and downstream alert dispatch fired twice.
--
-- The new index uses `coalesce(device_id, '00000000…'::uuid)` so the
-- NULL bucket is collapsed into a single deterministic value, plus a
-- payload->>'idempotency_key' so the bridge / firmware can supply a
-- per-message dedup key when device_id alone isn't unique within a
-- (occurred_at, type) window.
--
-- Rollback: drop index events_idempotency_uidx; restore the prior
--   create unique index events_device_occurred_type_uidx
--     on public.events (device_id, occurred_at, type)
--     where device_id is not null;

drop index if exists public.events_device_occurred_type_uidx;

create unique index if not exists events_idempotency_uidx
  on public.events (
    coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid),
    occurred_at,
    type,
    coalesce(payload->>'idempotency_key', '')
  );

comment on index public.events_idempotency_uidx is
  'Idempotency key for events (Phase I item 109). Coalesces NULL device_id into a sentinel UUID so device-less events also dedupe; payload.idempotency_key disambiguates same-(time,type) collisions when senders need it.';
