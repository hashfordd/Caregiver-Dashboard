import { describe, it, expect, beforeEach } from 'vitest';
import { usePositionMarkerStore } from '@/lib/stores/positionMarkerStore';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

const PATIENT_A = '11111111-1111-1111-1111-111111111111';
const PATIENT_B = '22222222-2222-2222-2222-222222222222';

function row(overrides: Partial<PositionEstimateRow> = {}): PositionEstimateRow {
  return {
    id: 'pe-1',
    patient_id: PATIENT_A,
    recorded_at: '2026-05-05T12:00:00Z',
    mode: 'indoor',
    x_canvas: 100,
    y_canvas: 200,
    lat: null,
    lng: null,
    confidence: 0.8,
    created_at: '2026-05-05T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  // Reset by draining any leftover refcounts from previous tests.
  const drain = (id: string) => {
    while ((usePositionMarkerStore.getState().refcountByPatient[id] ?? 0) > 0) {
      usePositionMarkerStore.getState().release(id);
    }
    // Defensive: clear any orphaned latest entry.
    usePositionMarkerStore.getState().acquire(id);
    usePositionMarkerStore.getState().release(id);
  };
  drain(PATIENT_A);
  drain(PATIENT_B);
});

describe('positionMarkerStore', () => {
  it('pushEstimate stores the latest row by patient', () => {
    usePositionMarkerStore.getState().acquire(PATIENT_A);
    const a = row({ id: 'pe-a-1', x_canvas: 100, y_canvas: 200 });
    usePositionMarkerStore.getState().pushEstimate(PATIENT_A, a);
    expect(usePositionMarkerStore.getState().latestByPatient[PATIENT_A]).toEqual(a);
  });

  it('keeps per-patient entries independent', () => {
    usePositionMarkerStore.getState().acquire(PATIENT_A);
    usePositionMarkerStore.getState().acquire(PATIENT_B);
    const a = row({ id: 'pe-a', patient_id: PATIENT_A });
    const b = row({ id: 'pe-b', patient_id: PATIENT_B, x_canvas: 999 });
    usePositionMarkerStore.getState().pushEstimate(PATIENT_A, a);
    usePositionMarkerStore.getState().pushEstimate(PATIENT_B, b);
    const state = usePositionMarkerStore.getState().latestByPatient;
    expect(state[PATIENT_A]).toEqual(a);
    expect(state[PATIENT_B]).toEqual(b);
  });

  it('overwrites the latest row on each push (most recent wins)', () => {
    usePositionMarkerStore.getState().acquire(PATIENT_A);
    const t0 = row({ id: 'pe-1', recorded_at: '2026-05-05T12:00:00Z', confidence: 0.5 });
    const t1 = row({ id: 'pe-2', recorded_at: '2026-05-05T12:00:01Z', confidence: 0.7 });
    usePositionMarkerStore.getState().pushEstimate(PATIENT_A, t0);
    usePositionMarkerStore.getState().pushEstimate(PATIENT_A, t1);
    expect(usePositionMarkerStore.getState().latestByPatient[PATIENT_A]).toEqual(t1);
  });

  it('release only clears the patient when the last subscriber leaves', () => {
    usePositionMarkerStore.getState().acquire(PATIENT_A);
    usePositionMarkerStore.getState().acquire(PATIENT_A);
    usePositionMarkerStore.getState().pushEstimate(PATIENT_A, row());
    usePositionMarkerStore.getState().release(PATIENT_A);
    // Still one subscriber: row stays.
    expect(usePositionMarkerStore.getState().latestByPatient[PATIENT_A]).toBeDefined();
    usePositionMarkerStore.getState().release(PATIENT_A);
    expect(usePositionMarkerStore.getState().latestByPatient[PATIENT_A]).toBeUndefined();
  });

  it('release clears one patient and leaves the other intact', () => {
    usePositionMarkerStore.getState().acquire(PATIENT_A);
    usePositionMarkerStore.getState().acquire(PATIENT_B);
    usePositionMarkerStore.getState().pushEstimate(PATIENT_A, row());
    usePositionMarkerStore.getState().pushEstimate(PATIENT_B, row({ patient_id: PATIENT_B }));
    usePositionMarkerStore.getState().release(PATIENT_A);
    const state = usePositionMarkerStore.getState().latestByPatient;
    expect(state[PATIENT_A]).toBeUndefined();
    expect(state[PATIENT_B]).toBeDefined();
  });
});
