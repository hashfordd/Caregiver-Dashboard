import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';
import type { SensorReadingRow } from '@alzcare/shared';

const PATIENT_A = '11111111-1111-1111-1111-111111111111';
const PATIENT_B = '22222222-2222-2222-2222-222222222222';

function row(overrides: Partial<SensorReadingRow> = {}): SensorReadingRow {
  return {
    id: 'sr-1',
    patient_id: PATIENT_A,
    device_id: 'd-1',
    recorded_at: new Date().toISOString(),
    hr_bpm: 72,
    spo2_pct: 98,
    temp_c: 36.5,
    accel: null,
    gyro: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function snapshot(patientId: string) {
  return useLiveSensorStore.getState().cards[patientId];
}

beforeEach(() => {
  useLiveSensorStore.setState({ cards: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('liveSensorStore', () => {
  it('appends one point per metric on a single push', () => {
    useLiveSensorStore.getState().pushReading(PATIENT_A, row());
    const cards = snapshot(PATIENT_A)!;
    expect(cards.hr.buffer).toHaveLength(1);
    expect(cards.hr.latest?.value).toBe(72);
    expect(cards.spo2.buffer).toHaveLength(1);
    expect(cards.temp.buffer).toHaveLength(1);
    expect(cards.hr.lastReceivedAt).not.toBeNull();
  });

  it('evicts buffer entries older than 5 minutes when a new point arrives', () => {
    const t0 = new Date('2026-05-04T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    useLiveSensorStore
      .getState()
      .pushReading(PATIENT_A, row({ recorded_at: t0.toISOString(), hr_bpm: 70 }));

    const t1 = new Date('2026-05-04T12:06:00Z'); // 6 min later
    vi.setSystemTime(t1);
    useLiveSensorStore
      .getState()
      .pushReading(PATIENT_A, row({ recorded_at: t1.toISOString(), hr_bpm: 80 }));

    const cards = snapshot(PATIENT_A)!;
    expect(cards.hr.buffer).toHaveLength(1);
    expect(cards.hr.buffer[0]?.v).toBe(80);
  });

  it('keeps separate slices per patient', () => {
    useLiveSensorStore.getState().pushReading(PATIENT_A, row({ hr_bpm: 70 }));
    useLiveSensorStore
      .getState()
      .pushReading(PATIENT_B, row({ patient_id: PATIENT_B, hr_bpm: 90 }));

    expect(snapshot(PATIENT_A)?.hr.latest?.value).toBe(70);
    expect(snapshot(PATIENT_B)?.hr.latest?.value).toBe(90);
  });

  it('reset clears the slice for the named patient only', () => {
    useLiveSensorStore.getState().pushReading(PATIENT_A, row());
    useLiveSensorStore.getState().pushReading(PATIENT_B, row({ patient_id: PATIENT_B }));

    useLiveSensorStore.getState().reset(PATIENT_A);

    expect(snapshot(PATIENT_A)).toBeUndefined();
    expect(snapshot(PATIENT_B)).toBeDefined();
  });
});
