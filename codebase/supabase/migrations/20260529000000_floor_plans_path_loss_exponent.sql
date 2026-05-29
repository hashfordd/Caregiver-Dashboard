-- Per-floor-plan path-loss exponent for the F8 indoor-positioning pipeline.
--
-- The log-distance path-loss model `distance = 10^((rssi_at_1m - rssi) /
-- (10 * n))` solves for the patient's distance from a beacon. `n` (the
-- exponent) is environment-dependent: 1.6–2.0 for free-space / open
-- plan, 2.5–3.5 for typical drywall apartments, 3.5–4.5 for concrete
-- buildings with body shadowing. Until this migration the value was a
-- single hard-coded constant (DEFAULT_PATH_LOSS_EXPONENT = 2.0 in
-- packages/shared/src/positioning/pathLoss.ts), which over-estimated
-- distance in absorptive rooms and undermined trilateration accuracy.
--
-- Stored on `floor_plans` rather than `patients` because the same
-- patient may have multiple floor plans (e.g. day-care + home in V2)
-- with different RF environments. NULL means "use the code default" so
-- existing rows don't need backfill — the estimator coalesces.

alter table public.floor_plans
  add column if not exists path_loss_exponent numeric;

-- Sanity bounds. The log-distance model is defined for any positive n;
-- the [1.0, 6.0] window covers every real-world indoor environment
-- the literature reports and guards against finger-slip data entry
-- (e.g. typing `20` instead of `2.0`).
alter table public.floor_plans
  add constraint floor_plans_path_loss_exponent_range
  check (path_loss_exponent is null or (path_loss_exponent >= 1.0 and path_loss_exponent <= 6.0));

comment on column public.floor_plans.path_loss_exponent is
  'Log-distance path-loss exponent used by the F8 indoor-positioning pipeline. '
  'NULL → estimator falls back to DEFAULT_PATH_LOSS_EXPONENT (2.0). '
  'Typical values: 1.8–2.0 free space, 2.5–3.5 drywall, 3.5–4.5 concrete.';
