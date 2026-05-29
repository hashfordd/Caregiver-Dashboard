-- F8 / Phase 5: position_estimates retention + downsample compactor.
--
-- position_estimates accumulates at ~1 Hz per patient. At one patient that
-- is ~600k rows/week; at any real multi-patient deployment the table (and
-- the history/replay reads against it) degrade fast. This adds a pg_cron
-- compactor that keeps recent data at full resolution and thins older data
-- to one row per patient/mode/minute, then hard-deletes very old rows.
--
-- Windows (conservative defaults; tune per deployment):
--   * < RAW_WINDOW            full resolution (live + recent replay)
--   * RAW_WINDOW … MAX_AGE    downsampled to 1 row / minute
--   * > MAX_AGE               deleted
--
-- The function is SECURITY DEFINER and owned by the migration role so the
-- cron job (which runs as the cron owner) can delete regardless of RLS.

create or replace function public.compact_position_estimates()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_window constant interval := interval '7 days';
  max_age    constant interval := interval '90 days';
begin
  -- 1. Downsample the RAW_WINDOW … MAX_AGE band to one row per
  --    (patient, mode, truncated-minute). Keep the earliest row in each
  --    minute bucket (deterministic) and delete the rest.
  with ranked as (
    select
      id,
      row_number() over (
        partition by patient_id, mode, date_trunc('minute', recorded_at)
        order by recorded_at asc, id asc
      ) as rn
    from public.position_estimates
    where recorded_at < now() - raw_window
      and recorded_at >= now() - max_age
  )
  delete from public.position_estimates pe
  using ranked
  where pe.id = ranked.id
    and ranked.rn > 1;

  -- 2. Hard-delete anything past MAX_AGE.
  delete from public.position_estimates
  where recorded_at < now() - max_age;
end;
$$;

revoke all on function public.compact_position_estimates() from public;

-- Schedule hourly (idempotent: unschedule first if present).
do $do$
begin
  perform cron.unschedule('position_estimates_compact_hourly');
exception when others then
  null;
end
$do$;

select cron.schedule(
  'position_estimates_compact_hourly',
  '7 * * * *',
  $$select public.compact_position_estimates();$$
);
