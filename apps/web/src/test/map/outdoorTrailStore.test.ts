import { beforeEach, describe, expect, it } from 'vitest';
import { useOutdoorTrailStore } from '@/lib/stores/outdoorTrailStore';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

const PATIENT = '11111111-1111-1111-1111-111111111111';

function row(
  secondsAgo: number,
  overrides: Partial<PositionEstimateRow> = {},
): PositionEstimateRow {
  const now = Date.parse('2026-05-06T10:00:00Z');
  return {
    id: `pe-${secondsAgo}`,
    patient_id: PATIENT,
    recorded_at: new Date(now - secondsAgo * 1000).toISOString(),
    mode: 'outdoor',
    x_canvas: null,
    y_canvas: null,
    lat: -37.81,
    lng: 144.96,
    confidence: 0.7,
    created_at: new Date(now - secondsAgo * 1000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  useOutdoorTrailStore.getState().reset(PATIENT);
});

describe('outdoorTrailStore', () => {
  it('hydrate seeds the trail sorted ascending', () => {
    useOutdoorTrailStore.getState().hydrate(PATIENT, [row(60), row(120), row(0)]);
    const trail = useOutdoorTrailStore.getState().byPatient[PATIENT] ?? [];
    expect(trail.map((r) => r.id)).toEqual(['pe-120', 'pe-60', 'pe-0']);
  });

  it('push appends and trims to a 30-min window', () => {
    // Newest row in the seed is 60 s old; a 32-min-old row is past the
    // 30-min cutoff and should be dropped.
    useOutdoorTrailStore.getState().hydrate(PATIENT, [row(32 * 60), row(60), row(120)]);
    let trail = useOutdoorTrailStore.getState().byPatient[PATIENT] ?? [];
    expect(trail.map((r) => r.id)).toEqual(['pe-120', 'pe-60']);

    // Push a now-row; the 32-min-old one stays gone, the 2-min-old stays.
    useOutdoorTrailStore.getState().push(PATIENT, row(0));
    trail = useOutdoorTrailStore.getState().byPatient[PATIENT] ?? [];
    expect(trail.map((r) => r.id)).toEqual(['pe-120', 'pe-60', 'pe-0']);
  });

  it('reset wipes the patient', () => {
    useOutdoorTrailStore.getState().hydrate(PATIENT, [row(0)]);
    expect(useOutdoorTrailStore.getState().byPatient[PATIENT]).toBeDefined();
    useOutdoorTrailStore.getState().reset(PATIENT);
    expect(useOutdoorTrailStore.getState().byPatient[PATIENT]).toBeUndefined();
  });
});
