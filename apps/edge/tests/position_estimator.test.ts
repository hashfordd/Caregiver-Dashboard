import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handlePositionEstimateRequest } from '../functions/position_estimator/handler';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const DEVICE_ID = '22222222-2222-2222-2222-222222222222';
const FLOOR_PLAN_ID = '33333333-3333-3333-3333-333333333333';
const SERVICE_ROLE_KEY = 'service-role-key-for-test';

const VALID_SIGNALS = {
  v: 1,
  patient_id: PATIENT_ID,
  device_id: DEVICE_ID,
  recorded_at: '2026-05-05T12:00:00.000Z',
  ble: [
    { mac: 'AA:01', rssi: -55 },
    { mac: 'AA:02', rssi: -65 },
    { mac: 'AA:03', rssi: -70 },
  ],
  wifi: [],
};

interface MockTable {
  select: ReturnType<typeof vi.fn>;
}

/** Builds a Supabase mock that the handler can drive through. Each
 *  table's queries are programmable per-test via the `tables` map.
 *  Mirrors the chained-mock pattern in processMessage.test.ts but
 *  returns realistic shapes (data + error) at the leaves where the
 *  handler awaits. */
function buildSupabase(programming: {
  beacons?: { data?: unknown; error?: { message: string } };
  floorPlanFallback?: { data?: unknown; error?: { message: string } };
  scale?: { data?: unknown; error?: { message: string } };
  calibrations?: { data?: unknown; error?: { message: string } };
  recentEstimates?: { data?: unknown; error?: { message: string } };
  insertPosition?: { data?: unknown; error?: { message: string } };
}): {
  client: SupabaseClient;
  calls: { table: string; method: string; args?: unknown[] }[];
  insertPayloads: unknown[];
} {
  const calls: { table: string; method: string; args?: unknown[] }[] = [];

  const beaconsResult = programming.beacons ?? { data: [], error: null };
  const fallbackResult = programming.floorPlanFallback ?? { data: null, error: null };
  const scaleResult = programming.scale ?? {
    data: { scale_meters_per_pixel: 0.02 },
    error: null,
  };
  const calResult = programming.calibrations ?? { data: [], error: null };
  const recentResult = programming.recentEstimates ?? { data: [], error: null };
  const insertResult = programming.insertPosition ?? {
    data: { id: 'pos-1' },
    error: null,
  };
  const insertPayloads: unknown[] = [];

  // Each call to .from(table) returns a fresh chainable builder. We
  // record method invocations + arguments for assertions. The
  // position_estimates branch is bimodal — it serves both the
  // recent-estimates SELECT (chain ending in .order().limit()) and
  // the result INSERT (chain starting with .insert().select().single()).
  const fromMock = vi.fn((table: string) => {
    calls.push({ table, method: 'from' });
    if (table === 'beacons') {
      return makeChain(calls, table, async () => beaconsResult);
    }
    if (table === 'floor_plans') {
      return makeChain(calls, table, async (leaf) =>
        leaf === 'maybeSingle' ? fallbackResult : scaleResult,
      );
    }
    if (table === 'calibration_points') {
      return makeChain(calls, table, async () => calResult);
    }
    if (table === 'position_estimates') {
      const chain = makeChain(calls, table, async () => recentResult) as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      chain.insert = (payload: unknown) => {
        calls.push({ table, method: 'insert', args: [payload] });
        insertPayloads.push(payload);
        // .insert().select('id').single() — terminal returns insertResult.
        return makeChain(calls, table, async () => insertResult);
      };
      return chain;
    }
    return makeChain(calls, table, async () => ({ data: [], error: null }));
  });

  return {
    client: { from: fromMock } as unknown as SupabaseClient,
    calls,
    insertPayloads,
  };
}

function makeChain(
  calls: { table: string; method: string; args?: unknown[] }[],
  table: string,
  resolver: (leafMethod: string) => Promise<unknown>,
) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const record = (method: string, args: unknown[]) => calls.push({ table, method, args });
  chain.select = (...args: unknown[]) => {
    record('select', args);
    return chain;
  };
  chain.eq = (...args: unknown[]) => {
    record('eq', args);
    return chain;
  };
  chain.order = (...args: unknown[]) => {
    record('order', args);
    return chain;
  };
  chain.limit = (...args: unknown[]) => {
    record('limit', args);
    return chain;
  };
  chain.single = () => {
    record('single', []);
    return resolver('single');
  };
  chain.maybeSingle = () => {
    record('maybeSingle', []);
    return resolver('maybeSingle');
  };
  // Awaiting the chain itself (no terminal method) returns the leaf
  // payload — used for select-without-single endpoints (beacons,
  // calibrations, position_estimates list).
  chain.then = (resolve: (value: unknown) => void, reject?: (e: unknown) => void) => {
    resolver('then').then(resolve, reject);
  };
  return chain;
}

function placedBeacon(id: string, mac: string, x: number, y: number) {
  return {
    id,
    patient_id: PATIENT_ID,
    floor_plan_id: FLOOR_PLAN_ID,
    mac_address: mac,
    x_canvas: x,
    y_canvas: y,
    tx_power: null,
    rssi_at_1m: -59,
  };
}

function calibration(id: string, x: number, y: number, ble: { mac: string; rssi_mean: number }[]) {
  return {
    id,
    floor_plan_id: FLOOR_PLAN_ID,
    x_canvas: x,
    y_canvas: y,
    ble_signature: {
      captured_at: '2026-05-05T00:00:00Z',
      samples: ble.map((b) => ({
        mac: b.mac,
        rssi_mean: b.rssi_mean,
        rssi_stddev: 1,
        sample_count: 30,
      })),
      quality: {
        sample_count_total: ble.length * 30,
        ble_count: ble.length * 30,
        wifi_count: 0,
        window_ms: 5000,
      },
    },
    wifi_signature: {
      captured_at: '2026-05-05T00:00:00Z',
      samples: [],
      quality: { sample_count_total: 0, ble_count: 0, wifi_count: 0, window_ms: 5000 },
    },
    captured_at: '2026-05-05T00:00:00Z',
  };
}

function authedRequest(body: unknown): Request {
  return new Request('http://localhost/functions/v1/position_estimator', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

describe('position_estimator handler', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns 405 on non-POST', async () => {
    const { client } = buildSupabase({});
    const req = new Request('http://localhost/functions/v1/position_estimator', { method: 'GET' });
    const res = await handlePositionEstimateRequest(req, client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(405);
  });

  it('returns 401 when Authorization header is missing or wrong', async () => {
    const { client } = buildSupabase({});
    const reqMissing = new Request('http://localhost/functions/v1/position_estimator', {
      method: 'POST',
      body: JSON.stringify(VALID_SIGNALS),
    });
    expect(
      (
        await handlePositionEstimateRequest(reqMissing, client, {
          serviceRoleKey: SERVICE_ROLE_KEY,
        })
      ).status,
    ).toBe(401);

    const reqWrong = new Request('http://localhost/functions/v1/position_estimator', {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-key' },
      body: JSON.stringify(VALID_SIGNALS),
    });
    expect(
      (await handlePositionEstimateRequest(reqWrong, client, { serviceRoleKey: SERVICE_ROLE_KEY }))
        .status,
    ).toBe(401);
  });

  it('returns 400 with Zod issues on a malformed SignalsMessage', async () => {
    const { client } = buildSupabase({});
    const req = authedRequest({ ...VALID_SIGNALS, recorded_at: 'not-a-date' });
    const res = await handlePositionEstimateRequest(req, client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string; issues: unknown[] };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_signals');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 400 on invalid JSON body', async () => {
    const { client } = buildSupabase({});
    const req = new Request('http://localhost/functions/v1/position_estimator', {
      method: 'POST',
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: '{not json',
    });
    const res = await handlePositionEstimateRequest(req, client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('returns skipped=no_beacons when the patient has no placed beacons', async () => {
    const { client } = buildSupabase({
      beacons: { data: [], error: null },
    });
    const res = await handlePositionEstimateRequest(authedRequest(VALID_SIGNALS), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skipped: boolean; reason: string };
    expect(body).toMatchObject({ ok: true, skipped: true, reason: 'no_beacons' });
  });

  it('returns skipped=no_scale when the active floor plan has scale_meters_per_pixel null', async () => {
    const { client } = buildSupabase({
      beacons: {
        data: [
          placedBeacon('b-1', 'AA:01', 0, 0),
          placedBeacon('b-2', 'AA:02', 250, 0),
          placedBeacon('b-3', 'AA:03', 125, 220),
        ],
        error: null,
      },
      scale: { data: { scale_meters_per_pixel: null }, error: null },
    });
    const res = await handlePositionEstimateRequest(authedRequest(VALID_SIGNALS), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: true, reason: 'no_scale' });
  });

  it('runs the pipeline + inserts the position_estimates row on a happy-path payload', async () => {
    const { client, calls, insertPayloads } = buildSupabase({
      beacons: {
        data: [
          placedBeacon('b-1', 'AA:01', 0, 0),
          placedBeacon('b-2', 'AA:02', 250, 0),
          placedBeacon('b-3', 'AA:03', 125, 220),
        ],
        error: null,
      },
      calibrations: {
        data: [
          calibration('c-1', 100, 100, [
            { mac: 'AA:01', rssi_mean: -55 },
            { mac: 'AA:02', rssi_mean: -65 },
            { mac: 'AA:03', rssi_mean: -70 },
          ]),
        ],
        error: null,
      },
      recentEstimates: { data: [], error: null },
      insertPosition: { data: { id: 'pos-from-mock' }, error: null },
    });

    const res = await handlePositionEstimateRequest(authedRequest(VALID_SIGNALS), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mode: 'indoor' | 'outdoor';
      confidence: number;
      position_estimate_id: string;
    };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('indoor');
    expect(body.confidence).toBeGreaterThan(0);
    expect(body.position_estimate_id).toBe('pos-from-mock');

    // Asserts the orchestrator ran the expected queries in order.
    const tablesQueried = calls.filter((c) => c.method === 'from').map((c) => c.table);
    expect(tablesQueried).toContain('beacons');
    expect(tablesQueried).toContain('floor_plans');
    expect(tablesQueried).toContain('calibration_points');
    expect(tablesQueried).toContain('position_estimates');
    // Recent estimates query is descending by recorded_at and limited to 6.
    const orderCalls = calls.filter((c) => c.method === 'order');
    expect(orderCalls.some((c) => (c.args as unknown[])[0] === 'recorded_at')).toBe(true);
    const limitCalls = calls.filter((c) => c.method === 'limit');
    expect(limitCalls.some((c) => (c.args as unknown[])[0] === 6)).toBe(true);

    // The insert payload carries the canonical row shape.
    expect(insertPayloads).toHaveLength(1);
    const inserted = insertPayloads[0] as Record<string, unknown>;
    expect(inserted.patient_id).toBe(PATIENT_ID);
    expect(inserted.recorded_at).toBe(VALID_SIGNALS.recorded_at);
    expect(inserted.mode).toBe('indoor');
    expect(inserted.x_canvas).toEqual(expect.any(Number));
    expect(inserted.y_canvas).toEqual(expect.any(Number));
    expect(inserted.confidence).toEqual(expect.any(Number));
  });

  it('returns 500 db_error when the position_estimates insert fails', async () => {
    const { client } = buildSupabase({
      beacons: {
        data: [
          placedBeacon('b-1', 'AA:01', 0, 0),
          placedBeacon('b-2', 'AA:02', 250, 0),
          placedBeacon('b-3', 'AA:03', 125, 220),
        ],
        error: null,
      },
      insertPosition: { data: null, error: { message: 'unique constraint' } },
    });
    const res = await handlePositionEstimateRequest(authedRequest(VALID_SIGNALS), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; table: string; details: string };
    expect(body.error).toBe('db_error');
    expect(body.table).toBe('position_estimates');
    expect(body.details).toBe('unique constraint');
  });

  it('runs trilateration-only when no calibration points exist (no skip)', async () => {
    const { client } = buildSupabase({
      beacons: {
        data: [
          placedBeacon('b-1', 'AA:01', 0, 0),
          placedBeacon('b-2', 'AA:02', 250, 0),
          placedBeacon('b-3', 'AA:03', 125, 220),
        ],
        error: null,
      },
      calibrations: { data: [], error: null },
      recentEstimates: { data: [], error: null },
    });
    const res = await handlePositionEstimateRequest(authedRequest(VALID_SIGNALS), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped?: boolean; mode?: string };
    expect(body.skipped).toBeUndefined();
    expect(body.mode).toBe('indoor');
  });

  it('returns skipped=no_signal when the pipeline produces null (no BLE + no GPS)', async () => {
    const { client } = buildSupabase({
      beacons: {
        data: [
          placedBeacon('b-1', 'AA:01', 0, 0),
          placedBeacon('b-2', 'AA:02', 250, 0),
          placedBeacon('b-3', 'AA:03', 125, 220),
        ],
        error: null,
      },
      calibrations: { data: [], error: null },
      recentEstimates: { data: [], error: null },
    });
    const empty = { ...VALID_SIGNALS, ble: [] };
    const res = await handlePositionEstimateRequest(authedRequest(empty), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: true, reason: 'no_signal' });
  });

  it('surfaces a db_error response when the beacons query fails', async () => {
    const { client } = buildSupabase({
      beacons: { data: null, error: { message: 'connection lost' } },
    });
    const res = await handlePositionEstimateRequest(authedRequest(VALID_SIGNALS), client, {
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: 'db_error', table: 'beacons' });
  });
});
