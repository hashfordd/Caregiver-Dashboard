// Edge function: rules_engine (handler module).
//
// Trigger: HTTP POST. Two callers in V1:
//   1. Supabase database webhook on INSERT into sensor_readings,
//      position_estimates, events. Body shape: { type, table, record }.
//   2. mqtt_bridge / position_estimator if a future internal-RPC path
//      lands. Same body shape.
//
// Auth: service-role bearer match. Database webhooks include the project's
// webhook secret in a header — Supabase doesn't expose webhook signing as
// a primitive yet, so we reuse the service-role key as the shared secret.
// The webhook config sets `Authorization: Bearer <SERVICE_ROLE_KEY>` so
// the same check works for both callers.
//
// Side effect: zero or more `alerts` row inserts via the service-role
// client. Each fired alert respects per-rule cooldown against the last
// unacked alert for the same (patient, rule), excluding alerts older than
// the rule's `updated_at` (CROSS_CUTTING §3 — a re-enable / threshold
// edit shouldn't be silenced by a pre-edit firing).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AlertRuleParams,
  evaluateRule,
  withinCooldown,
  type AlertRule,
  type AlertRuleType,
  type DataPoint,
  type EventRow,
  type HistoryWindow,
  type PositionEstimateRow,
  type SensorReadingRow,
  type ZoneRule,
} from './_shared/index.ts';

interface HandlerEnv {
  serviceRoleKey: string;
}

type WebhookTable = 'sensor_readings' | 'position_estimates' | 'events';

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: WebhookTable | string;
  schema?: string;
  record: Record<string, unknown>;
  old_record?: Record<string, unknown> | null;
}

interface DispatchOutcome {
  rule_id: string;
  decision: 'fire' | 'cooldown_suppressed' | 'no_match' | 'inserted' | 'insert_failed';
  alert_id?: string;
  details?: string;
}

const ALL_RULE_TYPES: readonly AlertRuleType[] = ['vitals', 'zone', 'fall', 'inactivity'] as const;

/** Maps the inserted source table to the rule types it can trigger.
 *  inactivity is intentionally absent — it fires on a scheduled tick,
 *  handled by the inactivity_scan function. */
const TRIGGER_MAP: Record<WebhookTable, AlertRuleType[]> = {
  sensor_readings: ['vitals'],
  position_estimates: ['zone'],
  events: ['fall'],
};

export async function handleRulesEngineRequest(
  req: Request,
  supabase: SupabaseClient,
  env: HandlerEnv,
): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (auth !== `Bearer ${env.serviceRoleKey}`) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  if (payload.type !== 'INSERT') {
    return json({ ok: true, skipped: true, reason: 'not_insert' }, 200);
  }
  const table = payload.table as WebhookTable;
  const candidateTypes = TRIGGER_MAP[table];
  if (!candidateTypes) {
    return json({ ok: true, skipped: true, reason: 'unhandled_table', table }, 200);
  }

  const patientId = payload.record.patient_id;
  if (typeof patientId !== 'string' || patientId.length === 0) {
    return json({ ok: false, error: 'missing_patient_id' }, 400);
  }

  // Build the data point from the webhook row. The webhook delivers the
  // raw column values; we trust the shape since the webhook only fires
  // on rows we wrote ourselves.
  const dataPoint = buildDataPoint(table, payload.record);

  // Fetch enabled rules for the patient that match the candidate type
  // set (one round-trip per webhook).
  const rulesRes = await supabase
    .from('alert_rules')
    .select('id, patient_id, type, params, severity, enabled, created_at, updated_at')
    .eq('patient_id', patientId)
    .eq('enabled', true)
    .in('type', candidateTypes);
  if (rulesRes.error) return dbError('alert_rules', rulesRes.error.message);

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
  const rules = rawRules.map((r) => parseRule(r)).filter((r): r is AlertRule => r != null);

  if (rules.length === 0) {
    return json({ ok: true, skipped: true, reason: 'no_rules' }, 200);
  }

  // Load history once per request, scoped to the largest window any
  // rule needs. Zone rules need positions for dwell-time confirmation;
  // vitals + fall rules don't need history. We over-fetch a small
  // bounded window rather than per-rule queries.
  const history = await loadHistoryWindow(supabase, table, patientId, rules);

  const outcomes: DispatchOutcome[] = [];
  for (const rule of rules) {
    const result = evaluateRule(rule, dataPoint, history);
    if (!result.fire) {
      outcomes.push({ rule_id: rule.id, decision: 'no_match' });
      continue;
    }

    // Cooldown check: most-recent unacked alert for this (patient, rule)
    // that landed AT OR AFTER rule.updated_at. The updated_at gate makes
    // a re-enable / threshold edit not be silenced by a pre-edit firing.
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
    if (lastFiredRes.error) return dbError('alerts (cooldown)', lastFiredRes.error.message);
    const lastFiredAt = (lastFiredRes.data as { fired_at: string } | null)?.fired_at ?? null;
    const nowIso = dataPointAt(dataPoint);
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
        details: insertRes.error?.message ?? 'no row returned',
      });
      continue;
    }
    outcomes.push({
      rule_id: rule.id,
      decision: 'inserted',
      alert_id: (insertRes.data as { id: string }).id,
    });
  }

  return json({ ok: true, table, outcomes }, 200);
}

// ─── helpers ──────────────────────────────────────────────────────────

function buildDataPoint(table: WebhookTable, record: Record<string, unknown>): DataPoint {
  switch (table) {
    case 'sensor_readings':
      return { kind: 'sensor_reading', row: record as unknown as SensorReadingRow };
    case 'position_estimates':
      return { kind: 'position_estimate', row: record as unknown as PositionEstimateRow };
    case 'events':
      return { kind: 'event', row: record as unknown as EventRow };
  }
}

function dataPointAt(dp: DataPoint): string {
  switch (dp.kind) {
    case 'sensor_reading':
      return dp.row.recorded_at;
    case 'position_estimate':
      return dp.row.recorded_at;
    case 'event':
      return dp.row.occurred_at;
    case 'tick':
      return dp.at;
  }
}

/** Defensive parse: the alert_rules.params JSONB is untyped at the
 *  storage layer. Rows that fail validation are dropped with a warn
 *  (the engine should never fall over on a malformed rule — that's a
 *  separate error class from "no match"). */
function parseRule(row: {
  id: string;
  patient_id: string;
  type: string;
  params: unknown;
  severity: 'info' | 'warn' | 'critical';
  enabled: boolean;
  created_at: string;
  updated_at: string;
}): AlertRule | null {
  const parsed = AlertRuleParams.safeParse({ type: row.type, params: row.params });
  if (!parsed.success) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'rules_engine: rule failed schema validation',
        rule_id: row.id,
        type: row.type,
        issues: parsed.error.issues,
      }),
    );
    return null;
  }
  return {
    id: row.id,
    patient_id: row.patient_id,
    severity: row.severity,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
    type: parsed.data.type,
    params: parsed.data.params,
  } as AlertRule;
}

const POSITION_HISTORY_LIMIT = 20;
const MAX_DWELL_SECONDS = 24 * 60 * 60; // sanity cap

/** Loads only the slice of history any of the active rules might need.
 *  For position_estimates inserts, that's the dwell window of any zone
 *  rule (capped). For other tables, no history is needed. */
async function loadHistoryWindow(
  supabase: SupabaseClient,
  table: WebhookTable,
  patientId: string,
  rules: AlertRule[],
): Promise<HistoryWindow> {
  const empty: HistoryWindow = { positions: [], sensors: [], events: [] };
  if (table !== 'position_estimates') return empty;

  const maxDwell = Math.min(
    MAX_DWELL_SECONDS,
    Math.max(
      0,
      ...rules
        .filter((r): r is ZoneRule => r.type === 'zone')
        .map((r) => r.params.dwell_seconds ?? 0),
    ),
  );
  if (maxDwell === 0) return empty;

  const sinceIso = new Date(Date.now() - (maxDwell + 60) * 1000).toISOString();
  const positionsRes = await supabase
    .from('position_estimates')
    .select(
      'id, patient_id, recorded_at, mode, x_canvas, y_canvas, lat, lng, confidence, indoor_confidence, gps_strong, created_at',
    )
    .eq('patient_id', patientId)
    .gte('recorded_at', sinceIso)
    .order('recorded_at', { ascending: false })
    .limit(POSITION_HISTORY_LIMIT);
  if (positionsRes.error) return empty;
  return { ...empty, positions: (positionsRes.data ?? []) as PositionEstimateRow[] };
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
