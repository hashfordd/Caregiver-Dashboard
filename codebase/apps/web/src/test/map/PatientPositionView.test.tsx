import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

vi.mock('@/features/floor-plan/usePositionMarker', () => ({
  usePositionMarker: () => latestEstimateRef.current,
}));

vi.mock('@/features/floor-plan/LivePositionView', () => ({
  LivePositionView: () => <div data-testid="indoor-view" />,
}));

vi.mock('@/features/map/OutdoorMapView', () => ({
  OutdoorMapView: () => <div data-testid="outdoor-view" />,
}));

import { PatientPositionView } from '@/features/floor-plan/PatientPositionView';

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

async function renderView(initialUrl = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let utils: ReturnType<typeof render> | undefined;
  await act(async () => {
    utils = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="*" element={<PatientPositionView patientId={PATIENT_ID} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return utils!;
}

describe('PatientPositionView toggle', () => {
  it('defaults to the indoor floor plan when no URL param is set', async () => {
    await renderView();
    expect(screen.getByTestId('indoor-view')).toBeTruthy();
    expect(screen.queryByTestId('outdoor-view')).toBeNull();
  });

  it('renders the outdoor map when ?livePos=outdoor', async () => {
    await renderView('/?livePos=outdoor');
    expect(screen.getByTestId('outdoor-view')).toBeTruthy();
    expect(screen.queryByTestId('indoor-view')).toBeNull();
  });

  it('renders the indoor view when ?livePos=indoor', async () => {
    await renderView('/?livePos=indoor');
    expect(screen.getByTestId('indoor-view')).toBeTruthy();
  });

  it('falls back to indoor when the URL param value is unknown', async () => {
    await renderView('/?livePos=bogus');
    expect(screen.getByTestId('indoor-view')).toBeTruthy();
  });

  it('ignores the detected mode — outdoor estimate does NOT auto-switch the view', async () => {
    // POS-08 auto-switch was removed in favour of a manual toggle. The
    // ModeIndicator inside OutdoorMapView still reports the detected
    // mode for information, but the view selection is user-driven.
    latestEstimateRef.current = outdoor();
    await renderView();
    expect(screen.getByTestId('indoor-view')).toBeTruthy();
    expect(screen.queryByTestId('outdoor-view')).toBeNull();
  });

  // Radix Tabs.Trigger commits the new value on mousedown (left button)
  // rather than click, so fireEvent.click is a silent no-op — we have
  // to dispatch mousedown with button:0 to drive the switch.
  it('switches view when the user clicks the outdoor tab', async () => {
    await renderView();
    expect(screen.getByTestId('indoor-view')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /outdoor map/i }), { button: 0 });
    await waitFor(() => {
      expect(screen.getByTestId('outdoor-view')).toBeTruthy();
    });
    expect(screen.queryByTestId('indoor-view')).toBeNull();
  });

  it('switches back when the user clicks the indoor tab', async () => {
    await renderView('/?livePos=outdoor');
    expect(screen.getByTestId('outdoor-view')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /floor plan/i }), { button: 0 });
    await waitFor(() => {
      expect(screen.getByTestId('indoor-view')).toBeTruthy();
    });
    expect(screen.queryByTestId('outdoor-view')).toBeNull();
  });
});
