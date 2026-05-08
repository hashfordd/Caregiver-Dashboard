// Edge function: position_estimator (handler module).
//
// Split from index.ts so the request flow is testable against a mocked
// Supabase client (mirrors mqtt_bridge/processMessage.ts). The HTTP
// shell in index.ts is a 5-line Deno.serve that reads env, builds the
// service-role client, and calls handlePositionEstimateRequest.
//
// Trigger: HTTP POST from mqtt_bridge after it validates a SignalsMessage.
// Auth: service-role bearer (defence in depth alongside verify_jwt = true).
// Side effect: one position_estimates row insert via the service-role
// client. Tests inject a mocked Supabase that records insert payloads
// without touching a real DB.
//
// Phase G updates:
//   - item 62: bearer check uses a constant-time string compare so a
//     timing oracle on the service-role key isn't possible.
//   - item 63: error responses no longer leak Postgres details to the
//     wire. Stable error codes go in the body; full diagnostics go to
//     server-side console.error only.
//   - item 66: the row INSERT goes through the
//     `insert_position_estimate_locked` SECURITY DEFINER RPC which
//     gates on a per-patient advisory lock. Concurrent estimator calls
//     for the same patient skip cleanly with `skipped: 'concurrent'`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { SignalsMessage } from '@alzcare/shared/mqtt';
import {
  runPositionPipeline,
  type BeaconRow,
  type CalibrationPoint,
  type RecentEstimate,
} from '@alzcare/shared/positioning';

const RECENT_ESTIMATES_LIMIT = 6; // smoothing uses 5; POS-08 hysteresis needs ≥ 4 priors

interface HandlerEnv {
  /** Service-role bearer the bridge must send. Compared by timing-safe
   *  string match in addition to verify_jwt = true on the function. */
  serviceRoleKey: string;
}

/** Constant-time string compare. JS's `===` short-circuits on the
 *  first byte mismatch, leaking length-of-equal-prefix to a remote
 *  attacker via response timing. Walking every byte regardless of
 *  result removes the oracle. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function handlePositionEstimateRequest(
  req: Request,
  supabase: SupabaseClient,
  env: HandlerEnv,
): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const expected = `Bearer ${env.serviceRoleKey}`;
  if (auth == null || !timingSafeEqual(auth, expected)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const validation = SignalsMessage.safeParse(body);
  if (!validation.success) {
    return json({ ok: false, error: 'invalid_signals', issues: validation.error.issues }, 400);
  }
  const m = validation.data;

  const beaconsRes = await supabase
    .from('beacons')
    .select('id, patient_id, floor_plan_id, mac_address, x_canvas, y_canvas, tx_power, rssi_at_1m')
    .eq('patient_id', m.patient_id);
  if (beaconsRes.error) return dbError('beacons', beaconsRes.error);

  const allBeacons = (beaconsRes.data ?? []) as BeaconRow[];
  const placedBeacons = allBeacons.filter((b) => b.x_canvas != null && b.y_canvas != null);
  if (placedBeacons.length === 0) {
    return json({ ok: true, skipped: true, reason: 'no_beacons' }, 200);
  }

  const beaconPlanId = placedBeacons.find((b) => b.floor_plan_id != null)?.floor_plan_id ?? null;
  let floorPlanId = beaconPlanId;
  if (floorPlanId == null) {
    const planRes = await supabase
      .from('floor_plans')
      .select('id')
      .eq('patient_id', m.patient_id)
      .eq('is_active', true)
      .maybeSingle();
    if (planRes.error) return dbError('floor_plans', planRes.error);
    floorPlanId = (planRes.data as { id: string } | null)?.id ?? null;
  }
  if (floorPlanId == null) {
    return json({ ok: true, skipped: true, reason: 'no_floor_plan' }, 200);
  }

  const scaleRes = await supabase
    .from('floor_plans')
    .select('scale_meters_per_pixel')
    .eq('id', floorPlanId)
    .single();
  if (scaleRes.error) return dbError('floor_plans', scaleRes.error);
  const scaleMetersPerPixel = (scaleRes.data as { scale_meters_per_pixel: number | null })
    .scale_meters_per_pixel;
  if (
    scaleMetersPerPixel == null ||
    !Number.isFinite(scaleMetersPerPixel) ||
    scaleMetersPerPixel <= 0
  ) {
    return json({ ok: true, skipped: true, reason: 'no_scale' }, 200);
  }

  const calRes = await supabase
    .from('calibration_points')
    .select('id, floor_plan_id, x_canvas, y_canvas, ble_signature, wifi_signature, captured_at')
    .eq('floor_plan_id', floorPlanId);
  if (calRes.error) return dbError('calibration_points', calRes.error);
  const calibrationPoints = (calRes.data ?? []) as CalibrationPoint[];

  const recentRes = await supabase
    .from('position_estimates')
    .select('recorded_at, mode, x_canvas, y_canvas, confidence, indoor_confidence, gps_strong')
    .eq('patient_id', m.patient_id)
    .order('recorded_at', { ascending: false })
    .limit(RECENT_ESTIMATES_LIMIT);
  if (recentRes.error) return dbError('position_estimates', recentRes.error);
  const recentEstimates = (recentRes.data ?? []) as RecentEstimate[];

  const result = runPositionPipeline({
    signals: m,
    beacons: placedBeacons,
    calibrationPoints,
    recentEstimates,
    scaleMetersPerPixel,
  });

  if (result == null) {
    return json({ ok: true, skipped: true, reason: 'no_signal' }, 200);
  }

  // Phase G item 66: serialised insert via SECURITY DEFINER RPC. The
  // function holds a per-patient advisory lock for its own transaction
  // so two parallel estimator calls for the same patient produce
  // ordered inserts (preserving POS-08 anti-flap), not interleaved
  // ones. SQLSTATE 55P03 ('lock_not_available' shape) signals
  // contention; we map that to a 200 skipped response so the bridge
  // doesn't retry.
  const lockedInsert = await supabase.rpc('insert_position_estimate_locked', {
    p_patient_id: m.patient_id,
    p_recorded_at: result.recorded_at,
    p_mode: result.mode,
    p_x_canvas: result.x_canvas,
    p_y_canvas: result.y_canvas,
    p_lat: result.lat,
    p_lng: result.lng,
    p_confidence: result.confidence,
    p_indoor_confidence: result.indoor_confidence,
    p_gps_strong: result.gps_strong,
  });
  if (lockedInsert.error) {
    if (lockedInsert.error.code === '55P03') {
      return json({ ok: true, skipped: true, reason: 'concurrent' }, 200);
    }
    return dbError('position_estimates', lockedInsert.error);
  }
  const newId = lockedInsert.data as string | null;
  if (!newId) {
    return dbError('position_estimates', new Error('rpc returned no id'));
  }

  return json(
    {
      ok: true,
      position_estimate_id: newId,
      mode: result.mode,
      confidence: result.confidence,
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Phase G item 63: server-side log gets the full diagnostic payload;
 *  the wire response only carries a stable error code. Postgres
 *  details (constraint names, table internals) never leave the
 *  function's logs. */
function dbError(
  table: string,
  err: { message?: string; code?: string; details?: string; hint?: string } | Error,
  status: number = 500,
): Response {
  const msg = (err as Error).message ?? '';
  const code = (err as { code?: string }).code;
  const details = (err as { details?: string }).details;
  const hint = (err as { hint?: string }).hint;
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'position_estimator: db error',
      table,
      code,
      details,
      hint,
      err: msg,
    }),
  );
  return json({ ok: false, error: 'db_error', table }, status);
}
