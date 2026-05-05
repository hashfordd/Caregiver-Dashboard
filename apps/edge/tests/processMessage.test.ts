import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processMessage } from '../functions/mqtt_bridge/processMessage';
import type { SupabaseClient } from '@supabase/supabase-js';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const DEVICE_ID = '22222222-2222-2222-2222-222222222222';

interface SupabaseMock extends SupabaseClient {
  __sensorInsertMock: ReturnType<typeof vi.fn>;
  __sensorSingleMock: ReturnType<typeof vi.fn>;
  __devicesUpdateMock: ReturnType<typeof vi.fn>;
  __devicesEqMock: ReturnType<typeof vi.fn>;
  __fromMock: ReturnType<typeof vi.fn>;
  __channelMock: ReturnType<typeof vi.fn>;
  __sendMock: ReturnType<typeof vi.fn>;
  __subscribeMock: ReturnType<typeof vi.fn>;
}

function buildSupabase(): SupabaseMock {
  const sensorSingleMock = vi.fn();
  const sensorInsertMock = vi.fn(() => ({
    select: vi.fn(() => ({ single: sensorSingleMock })),
  }));
  const devicesEqMock = vi.fn().mockResolvedValue({ error: null });
  const devicesUpdateMock = vi.fn(() => ({ eq: devicesEqMock }));
  const fromMock = vi.fn((table: string) => {
    if (table === 'sensor_readings') return { insert: sensorInsertMock };
    if (table === 'devices') return { update: devicesUpdateMock };
    return {};
  });
  // Channel mock: signals broadcast goes through .channel(name).send(...).
  // Default to a successful broadcast — individual tests override the
  // send mock to simulate failure.
  const sendMock = vi.fn().mockResolvedValue('ok');
  const subscribeMock = vi.fn();
  const channelMock = vi.fn(() => ({ subscribe: subscribeMock, send: sendMock }));
  const supabase = {
    from: fromMock,
    channel: channelMock,
    __sensorInsertMock: sensorInsertMock,
    __sensorSingleMock: sensorSingleMock,
    __devicesUpdateMock: devicesUpdateMock,
    __devicesEqMock: devicesEqMock,
    __fromMock: fromMock,
    __channelMock: channelMock,
    __sendMock: sendMock,
    __subscribeMock: subscribeMock,
  } as unknown as SupabaseMock;
  return supabase;
}

const VALID_TELEMETRY = {
  v: 1,
  patient_id: PATIENT_ID,
  device_id: DEVICE_ID,
  recorded_at: '2026-05-04T12:00:00.000Z',
  hr_bpm: 72,
  spo2_pct: 98,
  temp_c: 36.5,
};

describe('processMessage', () => {
  let supabase: SupabaseMock;

  beforeEach(() => {
    supabase = buildSupabase();
  });

  it('persists a valid telemetry payload and returns rowId', async () => {
    supabase.__sensorSingleMock.mockResolvedValue({ data: { id: 'sr-1' }, error: null });

    const outcome = await processMessage(
      `device/${PATIENT_ID}/telemetry`,
      VALID_TELEMETRY,
      supabase,
    );

    expect(outcome).toEqual({ kind: 'telemetry', persisted: true, rowId: 'sr-1' });
    expect(supabase.__fromMock).toHaveBeenCalledWith('sensor_readings');
    expect(supabase.__sensorInsertMock).toHaveBeenCalledTimes(1);
    expect(supabase.__sensorInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: PATIENT_ID,
        device_id: DEVICE_ID,
        recorded_at: '2026-05-04T12:00:00.000Z',
        hr_bpm: 72,
        spo2_pct: 98,
        temp_c: 36.5,
      }),
    );
  });

  it('bumps devices.last_seen_at after a successful telemetry persist (F10)', async () => {
    supabase.__sensorSingleMock.mockResolvedValue({ data: { id: 'sr-1' }, error: null });

    await processMessage(`device/${PATIENT_ID}/telemetry`, VALID_TELEMETRY, supabase);

    expect(supabase.__fromMock).toHaveBeenCalledWith('devices');
    expect(supabase.__devicesUpdateMock).toHaveBeenCalledTimes(1);
    expect(supabase.__devicesUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ last_seen_at: expect.any(String) }),
    );
    expect(supabase.__devicesEqMock).toHaveBeenCalledWith('id', DEVICE_ID);
  });

  it('returns a validation error and does not insert when telemetry is malformed', async () => {
    const outcome = await processMessage(
      `device/${PATIENT_ID}/telemetry`,
      { ...VALID_TELEMETRY, hr_bpm: 'not-a-number' },
      supabase,
    );

    expect(outcome.kind).toBe('telemetry');
    expect(outcome.persisted).toBe(false);
    if (outcome.kind === 'telemetry' && !outcome.persisted) {
      expect(outcome.error).toBe('validation');
    }
    expect(supabase.__sensorInsertMock).not.toHaveBeenCalled();
    expect(supabase.__devicesUpdateMock).not.toHaveBeenCalled();
  });

  it('broadcasts a valid signals payload on patient:<id>:signals (no DB write)', async () => {
    const payload = {
      v: 1,
      patient_id: PATIENT_ID,
      device_id: DEVICE_ID,
      recorded_at: '2026-05-04T12:00:00.000Z',
      ble: [{ mac: 'AA:BB:CC:DD:EE:01', rssi: -55 }],
      wifi: [],
    };
    const outcome = await processMessage(`device/${PATIENT_ID}/signals`, payload, supabase);

    expect(outcome).toMatchObject({ kind: 'signals', persisted: false, reason: 'broadcast' });
    expect(supabase.__channelMock).toHaveBeenCalledWith(`patient:${PATIENT_ID}:signals`);
    expect(supabase.__sendMock).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'signals',
      payload,
    });
    // Signals are not persisted — Phase 2 design.
    expect(supabase.__sensorInsertMock).not.toHaveBeenCalled();
    expect(supabase.__devicesUpdateMock).not.toHaveBeenCalled();
  });

  it('caches the signals channel per patient — second message re-uses the same channel object', async () => {
    const payload = {
      v: 1,
      patient_id: PATIENT_ID,
      device_id: DEVICE_ID,
      recorded_at: '2026-05-04T12:00:00.000Z',
      ble: [],
      wifi: [],
    };
    await processMessage(`device/${PATIENT_ID}/signals`, payload, supabase);
    await processMessage(`device/${PATIENT_ID}/signals`, payload, supabase);

    // channel(name) called once; subscribe() called once. send() twice.
    expect(supabase.__channelMock).toHaveBeenCalledTimes(1);
    expect(supabase.__subscribeMock).toHaveBeenCalledTimes(1);
    expect(supabase.__sendMock).toHaveBeenCalledTimes(2);
  });

  it('reports broadcast-failed when the realtime send rejects', async () => {
    supabase.__sendMock.mockRejectedValueOnce(new Error('socket closed'));
    const outcome = await processMessage(
      `device/${PATIENT_ID}/signals`,
      {
        v: 1,
        patient_id: PATIENT_ID,
        device_id: DEVICE_ID,
        recorded_at: '2026-05-04T12:00:00.000Z',
        ble: [],
        wifi: [],
      },
      supabase,
    );

    expect(outcome).toMatchObject({
      kind: 'signals',
      persisted: false,
      reason: 'broadcast-failed',
      details: 'socket closed',
    });
  });

  it('returns validation for a malformed signals payload (still no broadcast)', async () => {
    const outcome = await processMessage(
      `device/${PATIENT_ID}/signals`,
      { v: 1, patient_id: PATIENT_ID, device_id: DEVICE_ID, recorded_at: 'not-a-date' },
      supabase,
    );
    expect(outcome).toMatchObject({ kind: 'signals', persisted: false, reason: 'validation' });
    expect(supabase.__sendMock).not.toHaveBeenCalled();
  });

  describe('F8 estimator invocation', () => {
    const ENV = {
      supabaseUrl: 'http://127.0.0.1:54321',
      serviceRoleKey: 'service-role-key-test',
    };
    const VALID_SIGNALS = {
      v: 1,
      patient_id: PATIENT_ID,
      device_id: DEVICE_ID,
      recorded_at: '2026-05-04T12:00:00.000Z',
      ble: [{ mac: 'AA:BB:CC:DD:EE:01', rssi: -55 }],
      wifi: [],
    };
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('POSTs the validated payload to /functions/v1/position_estimator with service-role auth', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      try {
        const outcome = await processMessage(
          `device/${PATIENT_ID}/signals`,
          VALID_SIGNALS,
          supabase,
          ENV,
        );
        expect(outcome).toMatchObject({ kind: 'signals', reason: 'broadcast' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('http://127.0.0.1:54321/functions/v1/position_estimator');
        expect((init as RequestInit).method).toBe('POST');
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers.authorization).toBe('Bearer service-role-key-test');
        expect(headers['content-type']).toBe('application/json');
        expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
          patient_id: PATIENT_ID,
          recorded_at: VALID_SIGNALS.recorded_at,
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('does NOT POST when the bridge is invoked without env (back-compat for existing callers)', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      try {
        await processMessage(`device/${PATIENT_ID}/signals`, VALID_SIGNALS, supabase);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('logs a warn but still returns broadcast on a non-2xx estimator response', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ ok: false, error: 'db_error' }), { status: 500 }),
          ),
      );
      try {
        const outcome = await processMessage(
          `device/${PATIENT_ID}/signals`,
          VALID_SIGNALS,
          supabase,
          ENV,
        );
        expect(outcome).toMatchObject({ kind: 'signals', reason: 'broadcast' });
        expect(warnSpy).toHaveBeenCalled();
        const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
        expect(logged).toMatchObject({
          level: 'warn',
          msg: 'mqtt_bridge: position_estimator non-2xx',
          status: 500,
          patient_id: PATIENT_ID,
          recorded_at: VALID_SIGNALS.recorded_at,
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('logs a warn but still returns broadcast when the estimator fetch rejects', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket closed')));
      try {
        const outcome = await processMessage(
          `device/${PATIENT_ID}/signals`,
          VALID_SIGNALS,
          supabase,
          ENV,
        );
        expect(outcome).toMatchObject({ kind: 'signals', reason: 'broadcast' });
        expect(warnSpy).toHaveBeenCalled();
        const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
        expect(logged).toMatchObject({
          level: 'warn',
          msg: 'mqtt_bridge: position_estimator failed',
          err: 'socket closed',
          patient_id: PATIENT_ID,
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it('treats valid events as a phase-4 no-op (no insert)', async () => {
    const outcome = await processMessage(
      `device/${PATIENT_ID}/events`,
      {
        v: 1,
        patient_id: PATIENT_ID,
        device_id: DEVICE_ID,
        occurred_at: '2026-05-04T12:00:00.000Z',
        type: 'fall',
      },
      supabase,
    );

    expect(outcome).toMatchObject({ kind: 'events', persisted: false, reason: 'phase-4' });
    expect(supabase.__sensorInsertMock).not.toHaveBeenCalled();
    expect(supabase.__devicesUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown topic shape', async () => {
    const outcome = await processMessage('not/a/topic', VALID_TELEMETRY, supabase);
    expect(outcome).toMatchObject({ kind: 'unknown', persisted: false, error: 'topic' });
    expect(supabase.__sensorInsertMock).not.toHaveBeenCalled();
  });
});
