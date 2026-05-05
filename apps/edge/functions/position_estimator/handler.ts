// Edge function: position_estimator (handler module).
//
// Split from index.ts so the request flow is testable against a mocked
// Supabase client (mirrors mqtt_bridge/processMessage.ts). The HTTP
// shell in index.ts is a 5-line Deno.serve that reads env, builds the
// service-role client, and calls handlePositionEstimateRequest.
//
// Trigger: HTTP POST from mqtt_bridge after it validates a SignalsMessage.
// Auth: service-role bearer (defence in depth alongside verify_jwt = true).
// Side effect: one position_estimates row insert (slice 5 enables; slice
// 3 stubs the insert behind NODE_ENV so the unit test can assert the
// pre-insert call shape).

import type { SupabaseClient } from '@supabase/supabase-js';
import { SignalsMessage } from '@alzcare/shared/mqtt';
import {
  runPositionPipeline,
  type BeaconRow,
  type CalibrationPoint,
  type RecentEstimate,
} from '@alzcare/shared/positioning';

const RECENT_ESTIMATES_LIMIT = 6; // smoothing uses 5; mode-decision can read all 6

interface HandlerEnv {
  /** Service-role bearer the bridge must send. Compared by exact
   *  string match in addition to verify_jwt = true on the function. */
  serviceRoleKey: string;
}

export async function handlePositionEstimateRequest(
  req: Request,
  supabase: SupabaseClient,
  env: HandlerEnv,
): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (auth !== `Bearer ${env.serviceRoleKey}`) {
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

  // Beacons for this patient. We let the orchestrator filter null
  // x_canvas / y_canvas client-side so the pipeline's pure-function
  // contract isn't leaked into the SQL.
  const beaconsRes = await supabase
    .from('beacons')
    .select('id, patient_id, floor_plan_id, mac_address, x_canvas, y_canvas, tx_power, rssi_at_1m')
    .eq('patient_id', m.patient_id);
  if (beaconsRes.error) return dbError('beacons', beaconsRes.error.message);

  const allBeacons = (beaconsRes.data ?? []) as BeaconRow[];
  const placedBeacons = allBeacons.filter((b) => b.x_canvas != null && b.y_canvas != null);
  if (placedBeacons.length === 0) {
    return json({ ok: true, skipped: true, reason: 'no_beacons' }, 200);
  }

  // Determine the active floor plan. Prefer the floor_plan_id any
  // placed beacon already references (they're always all on the same
  // plan in V1 — a multi-plan patient would invalidate that). Fall
  // back to the patient's most recent floor_plans row.
  const beaconPlanId = placedBeacons.find((b) => b.floor_plan_id != null)?.floor_plan_id ?? null;
  let floorPlanId = beaconPlanId;
  if (floorPlanId == null) {
    const planRes = await supabase
      .from('floor_plans')
      .select('id')
      .eq('patient_id', m.patient_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (planRes.error) return dbError('floor_plans', planRes.error.message);
    floorPlanId = (planRes.data as { id: string } | null)?.id ?? null;
  }
  if (floorPlanId == null) {
    return json({ ok: true, skipped: true, reason: 'no_floor_plan' }, 200);
  }

  // Scale is required for trilateration's metres↔pixels conversion.
  // Without it, the pipeline can't produce a meaningful canvas position.
  const scaleRes = await supabase
    .from('floor_plans')
    .select('scale_meters_per_pixel')
    .eq('id', floorPlanId)
    .single();
  if (scaleRes.error) return dbError('floor_plans', scaleRes.error.message);
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
  if (calRes.error) return dbError('calibration_points', calRes.error.message);
  const calibrationPoints = (calRes.data ?? []) as CalibrationPoint[];

  const recentRes = await supabase
    .from('position_estimates')
    .select('recorded_at, mode, x_canvas, y_canvas, confidence')
    .eq('patient_id', m.patient_id)
    .order('recorded_at', { ascending: false })
    .limit(RECENT_ESTIMATES_LIMIT);
  if (recentRes.error) return dbError('position_estimates', recentRes.error.message);
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

  const insertRes = await supabase
    .from('position_estimates')
    .insert({
      patient_id: m.patient_id,
      recorded_at: result.recorded_at,
      mode: result.mode,
      x_canvas: result.x_canvas,
      y_canvas: result.y_canvas,
      lat: result.lat,
      lng: result.lng,
      confidence: result.confidence,
    })
    .select('id')
    .single();
  if (insertRes.error || !insertRes.data) {
    return dbError('position_estimates', insertRes.error?.message ?? 'no row returned', 500);
  }
  return json(
    {
      ok: true,
      position_estimate_id: (insertRes.data as { id: string }).id,
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

function dbError(table: string, details: string, status: number = 500): Response {
  return json({ ok: false, error: 'db_error', table, details }, status);
}
