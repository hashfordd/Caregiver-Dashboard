import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { forwardRef, useImperativeHandle } from 'react';
import type { ReactNode } from 'react';
import type { BeaconRow } from '@/features/beacons/types';
import type {
  BeaconSprite,
  FloorPlanCanvasHandle,
  FloorPlanRow,
  PatientMarkerSprite,
} from '@/features/floor-plan/types';
import type { PositionEstimateRow } from '@/lib/usePatientStream';
import type { PatientStreamContextValue } from '@/features/patients/PatientStreamContext';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

const {
  useFloorPlanMock,
  useBeaconsMock,
  patientStreamContext,
  registeredListeners,
  capturedHandle,
} = vi.hoisted(() => {
  const registeredListeners = new Set<(row: PositionEstimateRow) => void>();
  return {
    useFloorPlanMock: vi.fn(),
    useBeaconsMock: vi.fn(),
    patientStreamContext: { current: null as null | PatientStreamContextValue },
    registeredListeners,
    capturedHandle: {
      setBeacons: vi.fn(),
      setPatientMarker: vi.fn(),
    },
  };
});

vi.mock('@/features/floor-plan/floorPlanQueries', () => ({
  useFloorPlan: (...args: unknown[]) => useFloorPlanMock(...args),
  useUpsertFloorPlan: vi.fn(),
  useCalibrationCount: vi.fn(),
}));

vi.mock('@/features/beacons/beaconQueries', () => ({
  useBeacons: (...args: unknown[]) => useBeaconsMock(...args),
  useUpsertBeacon: vi.fn(),
  useUpdateBeaconPosition: vi.fn(),
  useDeleteBeacon: vi.fn(),
}));

vi.mock('@/features/patients/PatientStreamContext', () => ({
  usePatientStreamContext: () => patientStreamContext.current,
  PatientStreamProvider: ({ children }: { children: ReactNode }) => children,
}));

// Stub the heavy canvas; capture sprite + marker calls so the test can
// assert the wire-up without mounting Fabric.
vi.mock('@/features/floor-plan/FloorPlanCanvas', async () => {
  const FloorPlanCanvas = forwardRef<FloorPlanCanvasHandle, Record<string, unknown>>(
    function FloorPlanCanvasStub(_props, ref) {
      useImperativeHandle(ref, () => ({
        setMode: () => {},
        setFurnitureKind: () => {},
        serialize: () => null,
        deserialize: async () => {},
        getSelectedLinePixelLength: () => null,
        deleteSelected: () => {},
        clearAll: () => {},
        countObjects: () => ({ walls: 0, rooms: 0, furniture: 0 }),
        undo: () => {},
        redo: () => {},
        fitToContent: () => {},
        setSelectedWallLength: () => {},
        setBeacons: (sprites: BeaconSprite[]) => capturedHandle.setBeacons(sprites),
        armPlacement: () => {},
        setCalibrationPoints: () => {},
        armCalibrationCapture: () => {},
        setPatientMarker: (sprite: PatientMarkerSprite | null) =>
          capturedHandle.setPatientMarker(sprite),
      }));
      return <div data-testid="floor-plan-canvas-stub" />;
    },
  );
  return { FloorPlanCanvas };
});

import { LivePositionView } from '@/features/floor-plan/LivePositionView';
import { usePositionMarkerStore } from '@/lib/stores/positionMarkerStore';

const PLAN: FloorPlanRow = {
  id: '22222222-2222-2222-2222-222222222222',
  patient_id: PATIENT_ID,
  name: 'Floor plan',
  canvas_json: { objects: [] },
  scale_meters_per_pixel: 0.014,
  created_at: '2026-05-05T00:00:00Z',
};

function beacon(overrides: Partial<BeaconRow> = {}): BeaconRow {
  return {
    id: 'b-1',
    patient_id: PATIENT_ID,
    floor_plan_id: PLAN.id,
    mac_address: 'AA:01',
    label: 'Living room',
    x_canvas: 50,
    y_canvas: 100,
    tx_power: null,
    rssi_at_1m: null,
    created_at: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

function estimate(overrides: Partial<PositionEstimateRow> = {}): PositionEstimateRow {
  return {
    id: 'pe-1',
    patient_id: PATIENT_ID,
    recorded_at: '2026-05-05T12:00:00Z',
    mode: 'indoor',
    x_canvas: 250,
    y_canvas: 300,
    lat: null,
    lng: null,
    confidence: 0.8,
    created_at: '2026-05-05T12:00:00Z',
    ...overrides,
  };
}

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LivePositionView patientId={PATIENT_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  registeredListeners.clear();
  usePositionMarkerStore.getState().reset(PATIENT_ID);

  patientStreamContext.current = {
    patientId: PATIENT_ID,
    status: 'subscribed',
    lastSeen: { sensor: null, position: null, alert: null, signals: null },
    onSensorReading: () => () => {},
    onPositionEstimate: (cb: (row: PositionEstimateRow) => void) => {
      registeredListeners.add(cb);
      return () => {
        registeredListeners.delete(cb);
      };
    },
    onAlert: () => () => {},
    onSignals: () => () => {},
  };

  useFloorPlanMock.mockReturnValue({ data: PLAN, isLoading: false, isError: false });
  useBeaconsMock.mockReturnValue({ data: [], isLoading: false, isError: false });
});

describe('LivePositionView', () => {
  it('shows the empty-state when no floor plan is saved', () => {
    useFloorPlanMock.mockReturnValue({ data: null, isLoading: false, isError: false });
    renderView();
    expect(screen.getByText(/no floor plan yet/i)).toBeTruthy();
  });

  it('mirrors placed beacons into the canvas via setBeacons', () => {
    useBeaconsMock.mockReturnValue({
      data: [
        beacon({ id: 'b-1', x_canvas: 100, y_canvas: 200, label: 'Hallway' }),
        beacon({ id: 'b-unplaced', x_canvas: null, y_canvas: null }),
      ],
      isLoading: false,
      isError: false,
    });
    renderView();
    expect(capturedHandle.setBeacons).toHaveBeenCalled();
    const sprites = capturedHandle.setBeacons.mock.calls.at(-1)![0] as BeaconSprite[];
    // Only the placed beacon makes it into the sprite list.
    expect(sprites).toHaveLength(1);
    expect(sprites[0]).toMatchObject({ id: 'b-1', x: 100, y: 200, label: 'Hallway' });
  });

  it('renders the no-fix mode badge before any estimate arrives', () => {
    renderView();
    expect(screen.getByText(/no fix/i)).toBeTruthy();
  });

  it('on a new indoor estimate: dispatches setPatientMarker with the estimate coords + confidence', () => {
    renderView();
    const indoor = estimate({ x_canvas: 250, y_canvas: 300, confidence: 0.72 });
    act(() => {
      for (const cb of registeredListeners) cb(indoor);
    });
    expect(capturedHandle.setPatientMarker).toHaveBeenCalled();
    const lastCall = capturedHandle.setPatientMarker.mock.calls.at(-1)![0] as PatientMarkerSprite;
    expect(lastCall).toMatchObject({ x: 250, y: 300, confidence: 0.72 });
    expect(lastCall.recorded_at).toBe(indoor.recorded_at);
    expect(screen.getByText(/indoor/i)).toBeTruthy();
  });

  it('on an outdoor estimate: clears the marker and surfaces the outdoor banner', () => {
    renderView();
    const outdoor = estimate({ mode: 'outdoor', x_canvas: null, y_canvas: null });
    act(() => {
      for (const cb of registeredListeners) cb(outdoor);
    });
    // Last setPatientMarker call passes null (clear).
    expect(capturedHandle.setPatientMarker.mock.calls.at(-1)![0]).toBeNull();
    expect(screen.getByText(/patient is outdoors/i)).toBeTruthy();
    // The pill carries the exact word "Outdoor" (capitalised, no period).
    expect(screen.getByText(/^Outdoor$/)).toBeTruthy();
  });
});
