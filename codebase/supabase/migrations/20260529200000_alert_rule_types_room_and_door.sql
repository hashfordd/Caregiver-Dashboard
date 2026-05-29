-- Phase C: extend alert_rule_type so caregivers can build rules that
-- reference the new rooms + room_connectors tables.
--
--   room_transition — fires when a position estimate transitions into
--                     or out of a specific rooms.id polygon. Distinct
--                     from the existing 'zone' rule which embeds the
--                     polygon inline; this variant tracks the room as
--                     a stable entity so editing the polygon doesn't
--                     require re-saving every rule that references it.
--
--   door_proximity  — fires when a position estimate sits within
--                     params.radius_m of a specific room_connectors.id
--                     segment for params.dwell_seconds. Captures
--                     "patient near the front door" / "approaching the
--                     bedroom door" semantics.
--
-- Mirrors the device_silence enum-extension pattern (20260508110000):
-- ALTER TYPE ADD VALUE is non-transactional but idempotent under
-- IF NOT EXISTS, so re-running the migration is safe.

alter type public.alert_rule_type add value if not exists 'room_transition';
alter type public.alert_rule_type add value if not exists 'door_proximity';
