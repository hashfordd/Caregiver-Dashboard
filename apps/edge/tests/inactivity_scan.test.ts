import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleInactivityScan } from '../functions/inactivity_scan/handler';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const SERVICE_ROLE_KEY = 'service-role-key-for-test';

interface CallRecord {
  table: string;
  method: string;
  args?: unknown[];
}

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
  positionsByPatient?: Record<string, unknown[]>;
  lastFiredByRule?: Record<string, string | null>;
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
      return makeChain(calls, table, async () => {
        // Resolve which patient was asked by walking the recorded
        // .eq('patient_id', X) for this fetch (most recent wins).
        const patientEq = calls
          .filter((c) => c.table === 'position_estimates' && c.method === 'eq')
          .reverse()
          .find((c) => Array.isArray(c.args) && c.args[0] === 'patient_id');
        const pid = (patientEq?.args?.[1] as string | undefined) ?? PATIENT_ID;
        return { data: p.positionsByPatient?.[pid] ?? [], error: null };
      });
    }
    if (table === 'alerts') {
      const chain = makeChain(calls, table, async () => {
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
        return makeChain(calls, table, async () => ({
          data: { id: `alert-${insertPayloads.length}` },
          error: null,
        }));
      };
      return chain;
    }
    return makeChain(calls, table, async () => ({ data: [], error: null }));
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, calls, insertPayloads };
}

function authed(): Request {
  return new Request('http://localhost/functions/v1/inactivity_scan', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: '{}',
  });
}

const INACT_RULE = {
  id: 'rule-inact',
  patient_id: PATIENT_ID,
  type: 'inactivity',
  params: { inactive_minutes: 30 },
  severity: 'warn',
  enabled: true,
  created_at: '2026-05-06T00:00:00Z',
  updated_at: '2026-05-06T00:00:00Z',
};

function pos(t: string, x: number, y: number) {
  return {
    id: `pe-${t}`,
    patient_id: PATIENT_ID,
    recorded_at: t,
    mode: 'indoor',
    x_canvas: x,
    y_canvas: y,
    lat: null,
    lng: null,
    confidence: 0.8,
    indoor_confidence: 0.8,
    gps_strong: false,
    created_at: t,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inactivity_scan handler', () => {
  it('rejects non-POST', async () => {
    const { client } = buildSupabase({});
    const res = await handleInactivityScan(
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
      body: '{}',
    });
    const res = await handleInactivityScan(req, client, { serviceRoleKey: SERVICE_ROLE_KEY });
    expect(res.status).toBe(401);
  });

  it('returns no_match when there are no enabled inactivity rules', async () => {
    const { client, insertPayloads } = buildSupabase({});
    const res = await handleInactivityScan(authed(), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { rules: number };
    expect(json.rules).toBe(0);
    expect(insertPayloads).toHaveLength(0);
  });

  it('inserts an alert when the patient has been inactive past the threshold', async () => {
    // Older-than-30-min stationary rows. Use real Date.now()-relative
    // timestamps so the handler's own `new Date().toISOString()` tick
    // sees the gap.
    const now = Date.now();
    const oldT = new Date(now - 45 * 60_000).toISOString();
    const olderT = new Date(now - 50 * 60_000).toISOString();
    const { client, insertPayloads } = buildSupabase({
      rules: { data: [INACT_RULE], error: null },
      positionsByPatient: {
        [PATIENT_ID]: [pos(oldT, 100, 100), pos(olderT, 100, 100)],
      },
    });
    const res = await handleInactivityScan(authed(), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(200);
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0]).toMatchObject({
      patient_id: PATIENT_ID,
      rule_id: INACT_RULE.id,
      severity: 'warn',
    });
  });

  it('does not fire when the most recent motion is within the window', async () => {
    const now = Date.now();
    const recentMoveT = new Date(now - 60_000).toISOString();
    const recentMoveOldT = new Date(now - 120_000).toISOString();
    const { client, insertPayloads } = buildSupabase({
      rules: { data: [INACT_RULE], error: null },
      positionsByPatient: {
        [PATIENT_ID]: [pos(recentMoveT, 200, 200), pos(recentMoveOldT, 100, 100)],
      },
    });
    await handleInactivityScan(authed(), client, { serviceRoleKey: SERVICE_ROLE_KEY });
    expect(insertPayloads).toHaveLength(0);
  });
});
