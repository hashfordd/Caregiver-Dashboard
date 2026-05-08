// Edge function: inactivity_scan (handler module).
//
// Inactivity rules fire on the *absence* of motion, so a database
// webhook can't trigger them — there's no inserted row to react to.
// pg_cron schedules a per-minute POST to this function (configured in
// the migration); the function loops over every enabled inactivity
// rule, evaluates against the patient's recent position history, and
// inserts an `alerts` row when the threshold is exceeded.
//
// Auth: same service-role bearer match as rules_engine.
// Side effect: zero or more `alerts` row inserts.
//
// Phase G updates:
//   - item 62: timing-safe bearer compare.
//   - item 63: sanitised error responses (stable code on the wire,
//     full diagnostics in console.error).
//   - item 68: nowIso is captured once at the top and used for every
//     downstream calculation. The previous code re-read Date.now()
//     mid-loop, so a slow scan saw the lookback window slide
//     underneath itself — late iterations missed the most-recent
//     ticks.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AlertRuleParams,
  evaluateRule,
  withinCooldown,
  type AlertRule,
  type DeviceSilenceRule,
  type InactivityRule,
} from '@alzcare/shared/rules';
import type { PositionEstimateRow, SensorReadingRow } from '@alzcare/shared/db';

interface HandlerEnv {
  serviceRoleKey: string;
}

interface ScanOutcome {
  rule_id: string;
  decision: 'fire' | 'cooldown_suppressed' | 'no_match' | 'inserted' | 'insert_failed';
  alert_id?: string;
  details?: string;
}

const POSITION_LOOKBACK_LIMIT = 200;
/** How far back to fetch position history per rule. The rule's own
 *  `inactive_minutes` plus a small safety margin. Capped at 24 h. */
const MAX_LOOKBACK_MINUTES = 24 * 60;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function handleInactivityScan(
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

  // Phase G item 68: capture wall-clock once. nowMs is the canonical
  // reference for every per-rule lookback / cooldown / fired_at write
  // in this scan — re-reading Date.now() inside the loop produces a
  // sliding window where late iterations effectively miss the most-
  // recent ticks.
  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();

  // Item 131: this handler now scans both 'inactivity' and 'device_silence'
  // rule types. They share the cron tick + per-rule loop shape; only the
  // history fetch and evaluator branch differ.
  const rulesRes = await supabase
    .from('alert_rules')
    .select('id, patient_id, type, params, severity, enabled, created_at, updated_at')
    .in('type', ['inactivity', 'device_silence'])
    .eq('enabled', true);
  if (rulesRes.error) return dbError('alert_rules', rulesRes.error);

  const rawRules = (rulesRes.data ?? []) as Array<{
    id: string;
    patient_id: string;
    type: string;
    params: unknown;
    severity: 'info' | 'warn' | 'critical';
    enabled: boolean;
    created_at: string;
    updated_at: string;
  }>;
  const rules: AlertRule[] = [];
  for (const row of rawRules) {
    const parsed = AlertRuleParams.safeParse({ type: row.type, params: row.params });
    if (!parsed.success) continue;
    if (parsed.data.type === 'inactivity') {
      rules.push({
        id: row.id,
        patient_id: row.patient_id,
        severity: row.severity,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
        type: 'inactivity',
        params: parsed.data.params,
      } satisfies InactivityRule);
    } else if (parsed.data.type === 'device_silence') {
      rules.push({
        id: row.id,
        patient_id: row.patient_id,
        severity: row.severity,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
        type: 'device_silence',
        params: parsed.data.params,
      } satisfies DeviceSilenceRule);
    }
  }

  if (rules.length === 0) {
    return json({ ok: true, scanned_at: nowIso, rules: 0, outcomes: [] }, 200);
  }

  const outcomes: ScanOutcome[] = [];
  for (const rule of rules) {
    let positions: PositionEstimateRow[] = [];
    let sensors: SensorReadingRow[] = [];

    if (rule.type === 'inactivity') {
      const lookbackMinutes = Math.min(MAX_LOOKBACK_MINUTES, rule.params.inactive_minutes + 5);
      // Item 90: bound the lookback by rule.updated_at — we shouldn't
      // count "the patient was stationary" against position rows that
      // predate the rule's last edit. A freshly-edited threshold starts
      // counting from the edit moment.
      const lookbackStart = nowMs - lookbackMinutes * 60_000;
      const updatedMs = Date.parse(rule.updated_at);
      const sinceIso = new Date(Math.max(lookbackStart, updatedMs)).toISOString();
      const positionsRes = await supabase
        .from('position_estimates')
        .select(
          'id, patient_id, recorded_at, mode, x_canvas, y_canvas, lat, lng, confidence, indoor_confidence, gps_strong, created_at',
        )
        .eq('patient_id', rule.patient_id)
        .gte('recorded_at', sinceIso)
        .order('recorded_at', { ascending: false })
        .limit(POSITION_LOOKBACK_LIMIT);
      if (positionsRes.error) {
        outcomes.push({
          rule_id: rule.id,
          decision: 'no_match',
          details: 'position_fetch_failed',
        });
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'inactivity_scan: positions fetch failed',
            rule_id: rule.id,
            err: positionsRes.error.message,
          }),
        );
        continue;
      }
      positions = (positionsRes.data ?? []) as PositionEstimateRow[];
    } else {
      // device_silence: fetch the patient's newest sensor_reading. We
      // only need the timestamp.
      const sinceIso = new Date(
        Math.max(nowMs - MAX_LOOKBACK_MINUTES * 60_000, Date.parse(rule.updated_at)),
      ).toISOString();
      const sensorRes = await supabase
        .from('sensor_readings')
        .select('id, patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c, accel, gyro, created_at')
        .eq('patient_id', rule.patient_id)
        .gte('recorded_at', sinceIso)
        .order('recorded_at', { ascending: false })
        .limit(1);
      if (sensorRes.error) {
        outcomes.push({
          rule_id: rule.id,
          decision: 'no_match',
          details: 'sensor_fetch_failed',
        });
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'inactivity_scan: sensor fetch failed',
            rule_id: rule.id,
            err: sensorRes.error.message,
          }),
        );
        continue;
      }
      sensors = (sensorRes.data ?? []) as SensorReadingRow[];
    }

    const result = evaluateRule(
      rule,
      { kind: 'tick', at: nowIso },
      {
        positions,
        sensors,
        events: [],
      },
    );
    if (!result.fire) {
      outcomes.push({ rule_id: rule.id, decision: 'no_match' });
      continue;
    }

    const lastFiredRes = await supabase
      .from('alerts')
      .select('fired_at')
      .eq('patient_id', rule.patient_id)
      .eq('rule_id', rule.id)
      .is('acknowledged_at', null)
      .gte('fired_at', rule.updated_at)
      .order('fired_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastFiredRes.error) {
      outcomes.push({
        rule_id: rule.id,
        decision: 'no_match',
        details: 'cooldown_query_failed',
      });
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'inactivity_scan: cooldown query failed',
          rule_id: rule.id,
          err: lastFiredRes.error.message,
        }),
      );
      continue;
    }
    const lastFiredAt = (lastFiredRes.data as { fired_at: string } | null)?.fired_at ?? null;
    if (withinCooldown(rule, lastFiredAt, nowIso)) {
      outcomes.push({ rule_id: rule.id, decision: 'cooldown_suppressed' });
      continue;
    }

    const insertRes = await supabase
      .from('alerts')
      .insert({
        patient_id: rule.patient_id,
        rule_id: rule.id,
        severity: result.severity,
        fired_at: nowIso,
        context: result.context,
      })
      .select('id')
      .single();
    if (insertRes.error || !insertRes.data) {
      outcomes.push({
        rule_id: rule.id,
        decision: 'insert_failed',
        details: 'insert_failed',
      });
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'inactivity_scan: alert insert failed',
          rule_id: rule.id,
          err: insertRes.error?.message ?? 'no row returned',
        }),
      );
      continue;
    }
    outcomes.push({
      rule_id: rule.id,
      decision: 'inserted',
      alert_id: (insertRes.data as { id: string }).id,
    });
  }

  return json({ ok: true, scanned_at: nowIso, rules: rules.length, outcomes }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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
      msg: 'inactivity_scan: db error',
      table,
      code,
      details,
      hint,
      err: msg,
    }),
  );
  return json({ ok: false, error: 'db_error', table }, status);
}
