-- POS-08: full 5-second hysteresis on indoor↔outdoor mode switching.
--
-- The mode column carries the *applied* mode, not the per-tick *candidate
-- condition*. To count "≥ 5 consecutive seconds of agreement before
-- flipping" we need the candidate signal persisted so the stateless
-- estimator can read recent history and decide.
--
-- Two additive columns, no data backfill required (existing rows can be
-- NULL — the mode-decision logic treats NULL as "no information" and
-- degrades to the V1 single-tick decision until the window fills with
-- new rows).
--
-- The bridge writes via service-role and bypasses RLS, so no policy
-- changes are needed.

alter table public.position_estimates
  add column if not exists indoor_confidence numeric,
  add column if not exists gps_strong boolean;
