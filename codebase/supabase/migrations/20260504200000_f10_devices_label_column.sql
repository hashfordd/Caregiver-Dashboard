-- F10: caregivers can label their paired devices ("wrist left", "ankle"
-- etc.). Additive column; no backfill needed.

alter table public.devices add column if not exists label text;
