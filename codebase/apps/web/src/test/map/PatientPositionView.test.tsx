import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PositionEstimateRow } from '@/lib/usePatientStream';
import type { PatientStreamContextValue } from '@/features/patients/PatientStreamContext';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

const { patientStreamContext, registeredListeners, latestEstimateRef } = vi.hoisted(() => ({
  patientStreamContext: { current: null as null | PatientStreamContextValue },
  registeredListeners: new Set<(row: PositionEstimateRow) => void>(),
  latestEstimateRef: { current: undefined as PositionEstimateRow | undefined },
}));

vi.mock('@/features/patients/PatientStreamContext', () => ({
  usePatientStreamContext: () => patientStreamContext.current,
  PatientStreamProvider: ({ children }: { children: ReactNode }) => children,
}));

// Stub usePositionMarker so the test can drive estimates without
// dragging the realtime subscription wiring along.
vi.mock('@/features/floor-plan/usePositionMarker', () => ({
  usePositionMarker: () => latestEstimateRef.current,
}));

// Stub the indoor view — we only care which view PatientPositionView picks.
vi.mock('@/features/floor-plan/LivePositionView', () => ({
  LivePositionView: () => <div data-testid="indoor-view" />,
}));

// Stub the lazy outdoor view to a synchronous module so Suspense
// resolves immediately in the test.
vi.mock('@/features/map/OutdoorMapView', () => ({
  OutdoorMapView: () => <div data-testid="outdoor-view" />,
}));

import { PatientPositionView } from '@/features/floor-plan/PatientPositionView';

function indoor(): PositionEstimateRow {
  return {
    id: 'pe-indoor',
    patient_id: PATIENT_ID,
    recorded_at: '2026-05-06T10:00:00Z',
    mode: 'indoor',
    x_canvas: 100,
    y_canvas: 100,
    lat: null,
    lng: null,
    confidence: 0.8,
    created_at: '2026-05-06T10:00:00Z',
  };
}

function outdoor(): PositionEstimateRow {
  return {
    id: 'pe-outdoor',
    patient_id: PATIENT_ID,
    recorded_at: '2026-05-06T10:00:01Z',
    mode: 'outdoor',
    x_canvas: null,
    y_canvas: null,
    lat: -37.81,
    lng: 144.96,
    confidence: 0.7,
    created_at: '2026-05-06T10:00:01Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  registeredListeners.clear();
  latestEstimateRef.current = undefined;
  patientStreamContext.current = {
    patientId: PATIENT_ID,
    status: 'subscribed',
    lastSeen: { sensor: null, position: null, alert: null, signals: null },
    onSensorReading: () => () => {},
    onPositionEstimate: (cb) => {
      registeredListeners.add(cb);
      return () => {
        registeredListeners.delete(cb);
      };
    },
    onAlert: () => () => {},
    onSignals: () => () => {},
  };
});

async function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let utils: ReturnType<typeof render> | undefined;
  await act(async () => {
    utils = render(
      <QueryClientProvider client={qc}>
        <PatientPositionView patientId={PATIENT_ID} />
      </QueryClientProvider>,
    );
  });
  return utils!;
}

describe('PatientPositionView mode-router', () => {
  it('renders the indoor floor plan when no estimate has arrived', async () => {
    await renderView();
    expect(screen.getByTestId('indoor-view')).toBeTruthy();
    expect(screen.queryByTestId('outdoor-view')).toBeNull();
  });

  it('renders the indoor view when the latest estimate is indoor', async () => {
    latestEstimateRef.current = indoor();
    await renderView();
    expect(screen.getByTestId('indoor-view')).toBeTruthy();
  });

  it('renders the outdoor map when the latest estimate is outdoor', async () => {
    latestEstimateRef.current = outdoor();
    await renderView();
    expect(screen.getByTestId('outdoor-view')).toBeTruthy();
    expect(screen.queryByTestId('indoor-view')).toBeNull();
  });

  it('switches view when the mode changes between renders', async () => {
    latestEstimateRef.current = indoor();
    const { rerender } = await renderView();
    expect(screen.getByTestId('indoor-view')).toBeTruthy();

    latestEstimateRef.current = outdoor();
    await act(async () => {
      rerender(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <PatientPositionView patientId={PATIENT_ID} />
        </QueryClientProvider>,
      );
    });
    expect(screen.getByTestId('outdoor-view')).toBeTruthy();
  });
});
