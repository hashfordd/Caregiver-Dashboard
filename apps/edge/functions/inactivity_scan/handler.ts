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

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AlertRuleParams,
  evaluateRule,
  withinCooldown,
  type InactivityRule,
  type PositionEstimateRow,
} from './_shared/index.ts';

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

export async function handleInactivityScan(
  req: Request,
  supabase: SupabaseClient,
  env: HandlerEnv,
): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (auth !== `Bearer ${env.serviceRoleKey}`) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const nowIso = new Date().toISOString();

  const rulesRes = await supabase
    .from('alert_rules')
    .select('id, patient_id, type, params, severity, enabled, created_at, updated_at')
    .eq('type', 'inactivity')
    .eq('enabled', true);
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
  const rules: InactivityRule[] = [];
  for (const row of rawRules) {
    const parsed = AlertRuleParams.safeParse({ type: row.type, params: row.params });
    if (!parsed.success || parsed.data.type !== 'inactivity') continue;
    rules.push({
      id: row.id,
      patient_id: row.patient_id,
      severity: row.severity,
      enabled: row.enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
      type: 'inactivity',
      params: parsed.data.params,
    });
  }

  if (rules.length === 0) {
    return json({ ok: true, scanned_at: nowIso, rules: 0, outcomes: [] }, 200);
  }

  const outcomes: ScanOutcome[] = [];
  for (const rule of rules) {
    const lookbackMinutes = Math.min(MAX_LOOKBACK_MINUTES, rule.params.inactive_minutes + 5);
    const sinceIso = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
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
        details: `position fetch failed: ${positionsRes.error.message}`,
      });
      continue;
    }
    const positions = (positionsRes.data ?? []) as PositionEstimateRow[];

    const result = evaluateRule(
      rule,
      { kind: 'tick', at: nowIso },
      {
        positions,
        sensors: [],
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
        details: `cooldown query failed: ${lastFiredRes.error.message}`,
      });
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

  return json({ ok: true, scanned_at: nowIso, rules: rules.length, outcomes }, 200);
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
