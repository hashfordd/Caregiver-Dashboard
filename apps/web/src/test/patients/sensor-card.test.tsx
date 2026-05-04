import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SensorCard } from '@/features/patients/live/SensorCard';
import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';
import type { SensorReadingRow } from '@alzcare/shared';

const PATIENT = '11111111-1111-1111-1111-111111111111';

function row(overrides: Partial<SensorReadingRow> = {}): SensorReadingRow {
  return {
    id: 'sr-1',
    patient_id: PATIENT,
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

beforeEach(() => {
  useLiveSensorStore.setState({ cards: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SensorCard', () => {
  it('renders the awaiting-first-reading placeholder when the store is empty', () => {
    render(<SensorCard patientId={PATIENT} metric="hr" />);
    expect(screen.getByText(/awaiting first reading/i)).toBeInTheDocument();
  });

  it('renders the value, units, and a fresh pip after a reading lands', () => {
    act(() => {
      useLiveSensorStore.getState().pushReading(PATIENT, row({ hr_bpm: 80 }));
    });
    render(<SensorCard patientId={PATIENT} metric="hr" />);
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('bpm')).toBeInTheDocument();
    expect(screen.getByLabelText(/fresh/i)).toBeInTheDocument();
  });

  it('flips to the stale pip and shows seconds-since when 31s+ pass with no new reading', () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-05-04T12:00:00Z').getTime();
    vi.setSystemTime(t0);
    act(() => {
      useLiveSensorStore
        .getState()
        .pushReading(PATIENT, row({ recorded_at: new Date(t0).toISOString(), hr_bpm: 72 }));
    });

    render(<SensorCard patientId={PATIENT} metric="hr" />);
    expect(screen.getByLabelText(/fresh/i)).toBeInTheDocument();

    act(() => {
      vi.setSystemTime(t0 + 31_000);
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByLabelText(/stale/i)).toBeInTheDocument();
    expect(screen.getByText(/last updated 3[12]s ago/i)).toBeInTheDocument();
  });

  it('renders different metrics with their respective units', () => {
    act(() => {
      useLiveSensorStore
        .getState()
        .pushReading(PATIENT, row({ hr_bpm: 70, spo2_pct: 97, temp_c: 36.8 }));
    });
    const { rerender } = render(<SensorCard patientId={PATIENT} metric="spo2" />);
    expect(screen.getByText('97')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();

    rerender(<SensorCard patientId={PATIENT} metric="temp" />);
    expect(screen.getByText('36.8')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
  });
});
