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
  const supabase = {
    from: fromMock,
    __sensorInsertMock: sensorInsertMock,
    __sensorSingleMock: sensorSingleMock,
    __devicesUpdateMock: devicesUpdateMock,
    __devicesEqMock: devicesEqMock,
    __fromMock: fromMock,
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

  it('treats valid signals as a phase-2 no-op (no insert)', async () => {
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

    expect(outcome).toMatchObject({ kind: 'signals', persisted: false, reason: 'phase-2' });
    expect(supabase.__sensorInsertMock).not.toHaveBeenCalled();
    expect(supabase.__devicesUpdateMock).not.toHaveBeenCalled();
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
