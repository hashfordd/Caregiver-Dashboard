import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { forwardRef, useImperativeHandle } from 'react';
import type { BeaconRow } from '@/features/beacons/types';
import type {
  BeaconSprite,
  CalibrationPointSprite,
  FloorPlanCanvasHandle,
  FloorPlanRow,
  SelectionDescriptor,
  ToolMode,
} from '@/features/floor-plan/types';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_ID = '22222222-2222-2222-2222-222222222222';

const {
  useFloorPlanMock,
  useCalibrationCountMock,
  useUpsertFloorPlanMock,
  useBeaconsMock,
  updatePositionMock,
  deleteBeaconMock,
  upsertConnectorMock,
  capturedCanvasProps,
  capturedHandle,
} = vi.hoisted(() => ({
  useFloorPlanMock: vi.fn(),
  useCalibrationCountMock: vi.fn(),
  useUpsertFloorPlanMock: vi.fn(),
  useBeaconsMock: vi.fn(),
  updatePositionMock: vi.fn(),
  deleteBeaconMock: vi.fn(),
  upsertConnectorMock: vi.fn(),
  capturedCanvasProps: {
    current: null as null | {
      editing?: boolean;
      initialMode?: ToolMode;
      onDirty?: () => void;
      onSelectionChange?: (d: SelectionDescriptor) => void;
      onBeaconUpdate?: (id: string, x: number, y: number) => void;
      onCalibrationClick?: (x: number, y: number) => void;
      onConnectorDrawn?: (
        kind: 'door' | 'window',
        start: { x: number; y: number },
        end: { x: number; y: number },
      ) => void;
      onDimensionCommit?: (pixelLength: number, metres: number) => void;
    },
  },
  capturedHandle: {
    setMode: vi.fn(),
    setBeacons: vi.fn(),
    armPlacement: vi.fn(),
    armCalibrationCapture: vi.fn(),
    setCalibrationPoints: vi.fn(),
    setRooms: vi.fn(),
    setRoomConnectors: vi.fn(),
  },
}));

const mutateAsyncMock = vi.fn();

vi.mock('@/features/floor-plan/floorPlanQueries', () => ({
  useFloorPlan: (...args: unknown[]) => useFloorPlanMock(...args),
  useCalibrationCount: (...args: unknown[]) => useCalibrationCountMock(...args),
  useUpsertFloorPlan: (...args: unknown[]) => useUpsertFloorPlanMock(...args),
}));

vi.mock('@/features/beacons/beaconQueries', () => ({
  useBeacons: (...args: unknown[]) => useBeaconsMock(...args),
  useUpsertBeacon: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateBeaconPosition: () => ({ mutate: updatePositionMock, isPending: false }),
  useUpdateBeaconCalibration: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameBeacon: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteBeacon: () => ({
    mutate: deleteBeaconMock,
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
  }),
}));

vi.mock('@/features/floor-plan/roomQueries', () => ({
  useRooms: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useRoomConnectors: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useUpsertRoom: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteRoom: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUpsertRoomConnector: () => ({
    mutateAsync: upsertConnectorMock,
    isPending: false,
    error: null,
  }),
  useDeleteRoomConnector: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('@/features/alerts/useAlertRules', () => ({
  useAlertRules: () => ({ data: [], isLoading: false, isError: false }),
  useUpsertAlertRule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAlertRule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/floor-plan/useConnectorProximityRule', () => ({
  useConnectorProximityRule: () => ({
    createConnectorWithRule: upsertConnectorMock,
    deleteConnectorWithRule: vi.fn(),
    updateConnectorRadius: vi.fn(),
    upsertConnectorPending: false,
    deleteConnectorPending: false,
  }),
}));

vi.mock('@/features/calibration/calibrationQueries', () => ({
  useCalibrationPoints: () => ({ data: [], isLoading: false, isError: false }),
  useCaptureCalibrationPoint: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
  useDeleteCalibrationPoint: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    variables: undefined,
  }),
}));

vi.mock('@/features/patients/PatientStreamContext', () => ({
  usePatientStreamContext: () => ({
    patientId: PATIENT_ID,
    status: 'subscribed',
    lastSeen: { sensor: null, position: null, alert: null, signals: null },
    onSensorReading: () => () => {},
    onPositionEstimate: () => () => {},
    onAlert: () => () => {},
    onSignals: () => () => {},
  }),
}));

vi.mock('@/lib/devSignals', () => ({ publishFakeSignals: vi.fn() }));

// Stub the Fabric-backed canvas: capture the props the workspace wires in
// and expose the imperative handle as spies so we can assert mode/overlay
// orchestration without mounting Fabric.
vi.mock('@/features/floor-plan/FloorPlanCanvas', () => {
  const FloorPlanCanvas = forwardRef<FloorPlanCanvasHandle, Record<string, unknown>>(
    function FloorPlanCanvasStub(props, ref) {
      capturedCanvasProps.current = props as typeof capturedCanvasProps.current;
      useImperativeHandle(ref, () => ({
        setMode: (mode: ToolMode) => capturedHandle.setMode(mode),
        setFurnitureKind: () => {},
        serialize: () => ({ objects: [{ type: 'rect' }] }),
        deserialize: async () => {},
        getSelectedLinePixelLength: () => null,
        getSelectedPolygonVertices: () => null,
        deleteSelected: () => {},
        clearAll: () => {},
        countObjects: () => ({ walls: 0, rooms: 0, furniture: 0 }),
        undo: () => {},
        redo: () => {},
        fitToContent: () => {},
        setSelectedWallLength: () => {},
        setBeacons: (s: BeaconSprite[]) => capturedHandle.setBeacons(s),
        armPlacement: (id: string | null) => capturedHandle.armPlacement(id),
        setCalibrationPoints: (s: CalibrationPointSprite[]) =>
          capturedHandle.setCalibrationPoints(s),
        armCalibrationCapture: (a: boolean) => capturedHandle.armCalibrationCapture(a),
        setPatientMarker: () => {},
        setReplayDots: () => {},
        setRooms: () => capturedHandle.setRooms(),
        setRoomConnectors: () => capturedHandle.setRoomConnectors(),
      }));
      return (
        <div data-testid="floor-plan-canvas">
          <button
            type="button"
            aria-label="mark dirty"
            onClick={() => (props.onDirty as () => void)?.()}
          >
            dirty
          </button>
        </div>
      );
    },
  );
  return { FloorPlanCanvas };
});

import { PlaceWorkspace } from '@/features/place/PlaceWorkspace';

function plan(overrides: Partial<FloorPlanRow> = {}): FloorPlanRow {
  return {
    id: PLAN_ID,
    patient_id: PATIENT_ID,
    name: 'Floor plan',
    canvas_json: { objects: [] },
    scale_meters_per_pixel: 0.014,
    path_loss_exponent: null,
    created_at: '2026-05-04T00:00:00Z',
    updated_at: '2026-05-04T00:00:00Z',
    is_active: true,
    ...overrides,
  };
}

function beacon(overrides: Partial<BeaconRow> = {}): BeaconRow {
  return {
    id: 'b-1',
    patient_id: PATIENT_ID,
    floor_plan_id: PLAN_ID,
    mac_address: 'AA:BB:CC:DD:EE:01',
    label: 'Living room',
    x_canvas: null,
    y_canvas: null,
    tx_power: null,
    rssi_at_1m: null,
    created_at: '2026-05-04T00:00:00Z',
    ...overrides,
  };
}

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PlaceWorkspace patientId={PATIENT_ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedCanvasProps.current = null;
  useFloorPlanMock.mockReturnValue({ data: plan(), isLoading: false, isError: false });
  useCalibrationCountMock.mockReturnValue({ data: 0 });
  useUpsertFloorPlanMock.mockReturnValue({
    mutateAsync: mutateAsyncMock,
    isPending: false,
    isError: false,
    error: null,
  });
  useBeaconsMock.mockReturnValue({ data: [], isLoading: false, isError: false });
});

describe('PlaceWorkspace', () => {
  it('presents two bundles and mounts in the layout bundle with the toolbar', () => {
    renderWorkspace();
    // Two bundles, not four sub-tabs.
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /floor plan & rooms/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /beacons & calibration/i })).toBeInTheDocument();
    // Layout bundle shows the drawing toolbar + the rooms controls together.
    // Rooms are created by promoting a selected closed shape, not via an
    // "Add room" button (removed) — so the Promote-to-room control is present.
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /promote to room/i })).toBeInTheDocument();
    expect(capturedCanvasProps.current?.editing).toBe(false);
  });

  it('the devices bundle drives the canvas into placement mode on the same canvas', () => {
    renderWorkspace();
    const canvas = screen.getByTestId('floor-plan-canvas');
    fireEvent.click(screen.getByRole('tab', { name: /beacons & calibration/i }));
    expect(screen.getByTestId('floor-plan-canvas')).toBe(canvas); // not remounted
    expect(capturedHandle.setMode).toHaveBeenCalledWith('beacon-placement');
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it('mirrors every beacon (placed + unplaced) into the canvas overlay', () => {
    useBeaconsMock.mockReturnValue({
      data: [
        beacon({ id: 'b-1', label: 'Hallway' }),
        beacon({ id: 'b-2', label: 'Bedroom', x_canvas: 100, y_canvas: 200 }),
      ],
      isLoading: false,
      isError: false,
    });
    renderWorkspace();
    const sprites = capturedHandle.setBeacons.mock.calls.at(-1)![0] as BeaconSprite[];
    expect(sprites).toHaveLength(2);
    expect(sprites[0]).toMatchObject({ id: 'b-1', x: null, y: null });
    expect(sprites[1]).toMatchObject({ id: 'b-2', x: 100, y: 200 });
  });

  it('Place arms the canvas and onBeaconUpdate persists the position then disarms', () => {
    useBeaconsMock.mockReturnValue({
      data: [beacon({ id: 'b-1', label: 'Hallway' })],
      isLoading: false,
      isError: false,
    });
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: /beacons & calibration/i }));
    fireEvent.click(screen.getByRole('button', { name: /^place$/i }));
    expect(capturedHandle.armPlacement).toHaveBeenLastCalledWith('b-1');

    act(() => {
      capturedCanvasProps.current!.onBeaconUpdate!('b-1', 450, 320);
    });
    expect(updatePositionMock).toHaveBeenCalledWith({ id: 'b-1', x_canvas: 450, y_canvas: 320 });
    expect(capturedHandle.armPlacement).toHaveBeenLastCalledWith(null);
  });

  it('the Calibrate sub-toggle switches the canvas to calibration and arms capture', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: /beacons & calibration/i }));
    fireEvent.click(screen.getByRole('button', { name: /^calibrate$/i }));
    expect(capturedHandle.setMode).toHaveBeenLastCalledWith('calibration');
    expect(capturedHandle.armCalibrationCapture).toHaveBeenLastCalledWith(true);

    act(() => {
      capturedCanvasProps.current!.onCalibrationClick!(120, 240);
    });
    expect(capturedHandle.armCalibrationCapture).toHaveBeenLastCalledWith(false);
    const sprites = capturedHandle.setCalibrationPoints.mock.calls.at(
      -1,
    )![0] as CalibrationPointSprite[];
    expect(sprites.at(-1)).toMatchObject({ x: 120, y: 240, pending: true });
  });

  it('floor-plan save: Edit → dirty → Save upserts with scale and path-loss', async () => {
    mutateAsyncMock.mockResolvedValue(plan({ updated_at: '2026-05-04T12:34:56Z' }));
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /mark dirty/i }));
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PLAN_ID,
        patient_id: PATIENT_ID,
        canvas_json: { objects: [{ type: 'rect' }] },
        scale_meters_per_pixel: 0.014,
        path_loss_exponent: null,
      }),
    );
  });

  it('a drawn door is held pending (Save enabled) and persisted on Save, not on draw', async () => {
    mutateAsyncMock.mockResolvedValue(plan({ updated_at: '2026-05-04T12:34:56Z' }));
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^door$/i }));
    expect(capturedHandle.setMode).toHaveBeenLastCalledWith('door');

    // Drawing only QUEUES the connector — nothing is written yet, but the
    // plan is now dirty so Save is enabled ("save the plan when doors added").
    act(() => {
      capturedCanvasProps.current!.onConnectorDrawn!(
        'door',
        { x: 20.4, y: 40 },
        { x: 120, y: 40.6 },
      );
    });
    expect(upsertConnectorMock).not.toHaveBeenCalled();
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).not.toBeDisabled();

    // Saving the plan writes the queued door with rounded endpoints.
    fireEvent.click(save);
    await waitFor(() => expect(upsertConnectorMock).toHaveBeenCalledTimes(1));
    expect(upsertConnectorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        floor_plan_id: PLAN_ID,
        kind: 'door',
        start_x: 20,
        start_y: 40,
        end_x: 120,
        end_y: 41,
        room_a_id: null,
        room_b_id: null,
        label: null,
      }),
    );
  });

  it('typing a length on a wall/edge label recalibrates scale (inline canvas editing)', async () => {
    mutateAsyncMock.mockResolvedValue(plan({ updated_at: '2026-05-04T12:34:56Z' }));
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    // The caregiver types a real length directly on a wall/room-edge label;
    // the canvas reports the segment's pixel length + the entered metres.
    act(() => {
      capturedCanvasProps.current!.onDimensionCommit!(200, 4);
    });
    // 4 m / 200 px = 0.02 m/px — saving sends the recalibrated scale.
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ scale_meters_per_pixel: 0.02 }),
    );
  });

  it('exposes the bundles as an accessible tablist with arrow-key navigation', () => {
    renderWorkspace();
    const layoutTab = screen.getByRole('tab', { name: /floor plan & rooms/i });
    const devicesTab = screen.getByRole('tab', { name: /beacons & calibration/i });
    // Roving tabindex + aria wiring to a single tabpanel.
    expect(layoutTab).toHaveAttribute('aria-selected', 'true');
    expect(layoutTab).toHaveAttribute('aria-controls', 'place-tabpanel');
    expect(layoutTab).toHaveAttribute('tabindex', '0');
    expect(devicesTab).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'place-tab-layout');

    // ArrowRight moves selection (and focus) to the next tab.
    fireEvent.keyDown(layoutTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /beacons & calibration/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'place-tab-devices');
  });

  it('promotes rooms from the canvas selection, not a standalone Add room button', () => {
    renderWorkspace();
    // The "Add room" affordance is gone; rooms come from selecting a closed
    // shape and using Promote to room. With nothing selected the control is
    // disabled.
    expect(screen.queryByRole('button', { name: /^add room$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /promote to room/i })).toBeDisabled();
  });
});
