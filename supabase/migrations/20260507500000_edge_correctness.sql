-- Phase G items 65 + 66: events idempotency + position-estimator
-- per-patient advisory lock.
--
-- Item 65: webhook fan-out is at-least-once. Without an idempotency
-- key on `events`, a duplicate POST (network retry, replay-signals
-- second pass, mqtt_bridge re-receive) inserts a second row and
-- triggers a duplicate fall alert. A partial unique index on
-- (device_id, occurred_at, type) — partial because device_id is
-- nullable for non-device events — gives the bridge a clean ON
-- CONFLICT path for the upsert idempotency in processMessage.ts.
--
-- Item 66: concurrent invocations of the position_estimator can race
-- on the recent-estimates read (POS-08 hysteresis depends on prior
-- rows being coherent). The fix is to gate the insert behind a
-- transaction-scoped advisory lock keyed on the patient_id; a second
-- concurrent call gets denied immediately and the handler skips with
-- {skipped: 'concurrent'}. The next signals tick (~1s away) lands on a
-- clean lock window. Lock auto-releases at the end of the function's
-- own transaction.

-- ─────────────────────────────────────────────────────────────────────────
-- Item 65: events idempotency partial unique index
-- ─────────────────────────────────────────────────────────────────────────
create unique index if not exists events_device_occurred_type_uidx
  on public.events (device_id, occurred_at, type)
  where device_id is not null;

comment on index public.events_device_occurred_type_uidx is
  'Idempotency key for the bridge (Phase G item 65). Webhook retries / replay-signals reruns hit the unique index and the upsert path returns the existing row.';

-- ─────────────────────────────────────────────────────────────────────────
-- Item 66: locked position_estimate insert
-- ─────────────────────────────────────────────────────────────────────────
-- Wraps the INSERT in a transaction-scoped advisory lock keyed on the
-- patient_id. Concurrent calls for the same patient block on the lock
-- (or, with `try`, return false immediately). Calls for different
-- patients don't contend.
create or replace function public.insert_position_estimate_locked(
  p_patient_id uuid,
  p_recorded_at timestamptz,
  p_mode public.position_mode,
  p_x_canvas numeric,
  p_y_canvas numeric,
  p_lat numeric,
  p_lng numeric,
  p_confidence numeric,
  p_indoor_confidence numeric,
  p_gps_strong boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_lock_key bigint := hashtextextended('position_estimator:' || p_patient_id::text, 0);
begin
  if not pg_try_advisory_xact_lock(v_lock_key) then
    -- Concurrent estimator for the same patient — caller decides.
    -- Surfaced via PostgREST as a 'P0001' raised exception with this
    -- specific code so the handler can map it to a 200 'skipped' rather
    -- than a 5xx error.
    raise exception 'concurrent_estimator' using errcode = '55P03';
  end if;

  insert into public.position_estimates (
    patient_id,
    recorded_at,
    mode,
    x_canvas,
    y_canvas,
    lat,
    lng,
    confidence,
    indoor_confidence,
    gps_strong
  ) values (
    p_patient_id,
    p_recorded_at,
    p_mode,
    p_x_canvas,
    p_y_canvas,
    p_lat,
    p_lng,
    p_confidence,
    p_indoor_confidence,
    p_gps_strong
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.insert_position_estimate_locked(
  uuid, timestamptz, public.position_mode, numeric, numeric, numeric, numeric,
  numeric, numeric, boolean
) from public, anon, authenticated;

comment on function public.insert_position_estimate_locked is
  'Phase G item 66: serialised per-patient INSERT. Returns the new row id, or raises ''concurrent_estimator'' (SQLSTATE 55P03) if another estimator call holds the patient lock.';
