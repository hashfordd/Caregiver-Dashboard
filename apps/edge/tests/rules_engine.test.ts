import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleRulesEngineRequest } from '../functions/rules_engine/handler';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const DEVICE_ID = '22222222-2222-2222-2222-222222222222';
const SERVICE_ROLE_KEY = 'service-role-key-for-test';

interface CallRecord {
  table: string;
  method: string;
  args?: unknown[];
}

/** Minimal chain mock — supports the surface area both rules_engine and
 *  inactivity_scan exercise. Per-table programming maps the leaf result
 *  the chain resolves to. */
function makeChain(
  calls: CallRecord[],
  table: string,
  resolver: (leafMethod: string) => Promise<unknown>,
) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const record = (method: string, args: unknown[]) => calls.push({ table, method, args });
  for (const m of ['select', 'eq', 'in', 'is', 'gte', 'order', 'limit'] as const) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.single = () => {
    record('single', []);
    return resolver('single');
  };
  chain.maybeSingle = () => {
    record('maybeSingle', []);
    return resolver('maybeSingle');
  };
  chain.then = (resolve: (value: unknown) => void, reject?: (e: unknown) => void) => {
    resolver('then').then(resolve, reject);
  };
  return chain;
}

interface Programming {
  rules?: { data?: unknown; error?: { message: string } };
  positions?: { data?: unknown; error?: { message: string } };
  /** Per (rule_id) → last fired_at for cooldown lookup. */
  lastFiredByRule?: Record<string, string | null>;
  /** When set, alerts.insert returns this error instead of success. */
  insertError?: { message: string };
}

function buildSupabase(p: Programming): {
  client: SupabaseClient;
  calls: CallRecord[];
  insertPayloads: unknown[];
} {
  const calls: CallRecord[] = [];
  const insertPayloads: unknown[] = [];
  const fromMock = vi.fn((table: string) => {
    calls.push({ table, method: 'from' });
    if (table === 'alert_rules') {
      return makeChain(calls, table, async () => p.rules ?? { data: [], error: null });
    }
    if (table === 'position_estimates') {
      return makeChain(calls, table, async () => p.positions ?? { data: [], error: null });
    }
    if (table === 'alerts') {
      // Two flavours of chain: select+eq+...+maybeSingle → cooldown
      // lookup; insert+select+single → alert insert. We re-use a single
      // chain that resolves based on which terminal is hit.
      const chain = makeChain(calls, table, async () => {
        // For maybeSingle (cooldown), figure out which rule we're querying
        // from the recorded eq() args. The handler queries .eq('rule_id', X).
        const ruleEq = calls
          .filter((c) => c.table === 'alerts' && c.method === 'eq')
          .reverse()
          .find((c) => Array.isArray(c.args) && c.args[0] === 'rule_id');
        const ruleId = (ruleEq?.args?.[1] as string | undefined) ?? null;
        const lastFiredAt = ruleId != null ? (p.lastFiredByRule?.[ruleId] ?? null) : null;
        return { data: lastFiredAt == null ? null : { fired_at: lastFiredAt }, error: null };
      }) as Record<string, (...args: unknown[]) => unknown>;
      chain.insert = (payload: unknown) => {
        calls.push({ table, method: 'insert', args: [payload] });
        insertPayloads.push(payload);
        return makeChain(calls, table, async () => {
          if (p.insertError) return { data: null, error: p.insertError };
          return { data: { id: `alert-${insertPayloads.length}` }, error: null };
        });
      };
      return chain;
    }
    return makeChain(calls, table, async () => ({ data: [], error: null }));
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, calls, insertPayloads };
}

function authed(body: unknown): Request {
  return new Request('http://localhost/functions/v1/rules_engine', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

const VITALS_RULE = {
  id: 'rule-vitals',
  patient_id: PATIENT_ID,
  type: 'vitals',
  params: { metric: 'hr_bpm', min: 50, max: 110 },
  severity: 'warn',
  enabled: true,
  created_at: '2026-05-06T00:00:00Z',
  updated_at: '2026-05-06T00:00:00Z',
};

const FALL_RULE = {
  id: 'rule-fall',
  patient_id: PATIENT_ID,
  type: 'fall',
  params: {},
  severity: 'critical',
  enabled: true,
  created_at: '2026-05-06T00:00:00Z',
  updated_at: '2026-05-06T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rules_engine handler — auth + payload shape', () => {
  it('rejects non-POST', async () => {
    const { client } = buildSupabase({});
    const res = await handleRulesEngineRequest(
      new Request('http://localhost/x', { method: 'GET' }),
      client,
      { serviceRoleKey: SERVICE_ROLE_KEY },
    );
    expect(res.status).toBe(405);
  });

  it('rejects missing service-role bearer', async () => {
    const { client } = buildSupabase({});
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ type: 'INSERT', table: 'sensor_readings', record: {} }),
    });
    const res = await handleRulesEngineRequest(req, client, { serviceRoleKey: SERVICE_ROLE_KEY });
    expect(res.status).toBe(401);
  });

  it('skips DELETE / UPDATE webhooks', async () => {
    const { client, calls } = buildSupabase({});
    const res = await handleRulesEngineRequest(
      authed({ type: 'DELETE', table: 'sensor_readings', record: {} }),
      client,
      { serviceRoleKey: SERVICE_ROLE_KEY },
    );
    const json = (await res.json()) as { skipped: boolean; reason: string };
    expect(json.skipped).toBe(true);
    expect(json.reason).toBe('not_insert');
    expect(calls.find((c) => c.table === 'alert_rules')).toBeUndefined();
  });

  it('skips webhooks for unhandled tables', async () => {
    const { client } = buildSupabase({});
    const res = await handleRulesEngineRequest(
      authed({ type: 'INSERT', table: 'unknown_table', record: { patient_id: PATIENT_ID } }),
      client,
      { serviceRoleKey: SERVICE_ROLE_KEY },
    );
    const json = (await res.json()) as { skipped: boolean; reason: string };
    expect(json.reason).toBe('unhandled_table');
  });
});

describe('rules_engine handler — vitals dispatch', () => {
  it('inserts an alert when a vitals rule fires', async () => {
    const sensorRow = {
      id: '11111111-aaaa-bbbb-cccc-111111111111',
      patient_id: PATIENT_ID,
      device_id: DEVICE_ID,
      recorded_at: '2026-05-06T10:00:00Z',
      hr_bpm: 200,
      spo2_pct: 97,
      temp_c: 36.6,
      accel: null,
      gyro: null,
      created_at: '2026-05-06T10:00:00Z',
    };
    const { client, insertPayloads } = buildSupabase({
      rules: { data: [VITALS_RULE], error: null },
    });
    const res = await handleRulesEngineRequest(
      authed({ type: 'INSERT', table: 'sensor_readings', record: sensorRow }),
      client,
      { serviceRoleKey: SERVICE_ROLE_KEY },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { outcomes: { decision: string }[] };
    expect(json.outcomes[0]?.decision).toBe('inserted');
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0]).toMatchObject({
      patient_id: PATIENT_ID,
      rule_id: VITALS_RULE.id,
      severity: 'warn',
    });
  });

  it('does not fire when the value is inside the range', async () => {
    const sensorRow = {
      id: '22222222-aaaa-bbbb-cccc-222222222222',
      patient_id: PATIENT_ID,
      device_id: DEVICE_ID,
      recorded_at: '2026-05-06T10:00:00Z',
      hr_bpm: 80,
      spo2_pct: 97,
      temp_c: 36.6,
      accel: null,
      gyro: null,
      created_at: '2026-05-06T10:00:00Z',
    };
    const { client, insertPayloads } = buildSupabase({
      rules: { data: [VITALS_RULE], error: null },
    });
    const res = await handleRulesEngineRequest(
      authed({ type: 'INSERT', table: 'sensor_readings', record: sensorRow }),
      client,
      { serviceRoleKey: SERVICE_ROLE_KEY },
    );
    expect(res.status).toBe(200);
    expect(insertPayloads).toHaveLength(0);
  });

  it('suppresses when within cooldown of an unacked prior firing', async () => {
    const sensorRow = {
      id: '33333333-aaaa-bbbb-cccc-333333333333',
      patient_id: PATIENT_ID,
      device_id: DEVICE_ID,
      recorded_at: '2026-05-06T10:01:00Z',
      hr_bpm: 200,
      spo2_pct: 97,
      temp_c: 36.6,
      accel: null,
      gyro: null,
      created_at: '2026-05-06T10:01:00Z',
    };
    const { client, insertPayloads } = buildSupabase({
      rules: { data: [VITALS_RULE], error: null },
      lastFiredByRule: { [VITALS_RULE.id]: '2026-05-06T10:00:00Z' },
    });
    const res = await handleRulesEngineRequest(
      authed({ type: 'INSERT', table: 'sensor_readings', record: sensorRow }),
      client,
      { serviceRoleKey: SERVICE_ROLE_KEY },
    );
    const json = (await res.json()) as { outcomes: { decision: string }[] };
    expect(json.outcomes[0]?.decision).toBe('cooldown_suppressed');
    expect(insertPayloads).toHaveLength(0);
  });
});

describe('rules_engine handler — fall dispatch', () => {
  it('inserts an alert when an events row of type=fall arrives', async () => {
    const eventRow = {
      id: '44444444-aaaa-bbbb-cccc-444444444444',
      patient_id: PATIENT_ID,
      device_id: DEVICE_ID,
      occurred_at: '2026-05-06T10:00:00Z',
      type: 'fall',
      payload: { reason: 'impact' },
      created_at: '2026-05-06T10:00:00Z',
    };
    const { client, insertPayloads } = buildSupabase({
      rules: { data: [FALL_RULE], error: null },
    });
    const res = await handleRulesEngineRequest(
      authed({ type: 'INSERT', table: 'events', record: eventRow }),
      client,
      { serviceRoleKey: SERVICE_ROLE_KEY },
    );
    expect(res.status).toBe(200);
    expect(insertPayloads[0]).toMatchObject({
      rule_id: FALL_RULE.id,
      severity: 'critical',
    });
  });

  it('does not fire for non-fall events', async () => {
    const eventRow = {
      id: '55555555-aaaa-bbbb-cccc-555555555555',
      patient_id: PATIENT_ID,
      device_id: DEVICE_ID,
      occurred_at: '2026-05-06T10:00:00Z',
      type: 'low_battery',
      payload: {},
      created_at: '2026-05-06T10:00:00Z',
    };
    const { client, insertPayloads } = buildSupabase({
      rules: { data: [FALL_RULE], error: null },
    });
    await handleRulesEngineRequest(
      authed({ type: 'INSERT', table: 'events', record: eventRow }),
      client,
      { serviceRoleKey: SERVICE_ROLE_KEY },
    );
    expect(insertPayloads).toHaveLength(0);
  });
});
