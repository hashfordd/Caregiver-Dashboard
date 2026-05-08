import { createRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BeaconRow } from '@/features/beacons/types';
import type {
  BeaconSprite,
  FloorPlanRow,
  FloorPlanCanvasHandle,
} from '@/features/floor-plan/types';

const { useUpdateBeaconPositionMock, mutateMock, capturedCanvasProps, capturedHandle } = vi.hoisted(
  () => ({
    useUpdateBeaconPositionMock: vi.fn(),
    mutateMock: vi.fn(),
    capturedCanvasProps: {
      current: null as null | { onBeaconUpdate?: (id: string, x: number, y: number) => void },
    },
    capturedHandle: { setBeacons: vi.fn(), armPlacement: vi.fn() },
  }),
);

vi.mock('@/features/beacons/beaconQueries', () => ({
  useUpdateBeaconPosition: (...args: unknown[]) => useUpdateBeaconPositionMock(...args),
  useBeacons: vi.fn(),
  useUpsertBeacon: vi.fn(),
  useDeleteBeacon: vi.fn(),
}));

// Stand-in for the F5 canvas. Captures the props we care about so the
// placement-canvas test can drive onBeaconUpdate from outside, and
// exposes the same imperative handle shape (setBeacons / armPlacement)
// so the parent's useEffect mirrors data into our spy.
vi.mock('@/features/floor-plan/FloorPlanCanvas', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const FloorPlanCanvas = forwardRef<FloorPlanCanvasHandle, Record<string, unknown>>(
    function FloorPlanCanvasStub(props, ref) {
      capturedCanvasProps.current = props as {
        onBeaconUpdate?: (id: string, x: number, y: number) => void;
      };
      useImperativeHandle(ref, () => {
        const setBeacons = (sprites: BeaconSprite[]) => {
          capturedHandle.setBeacons(sprites);
        };
        const armPlacement = (id: string | null) => {
          capturedHandle.armPlacement(id);
        };
        return {
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
          setBeacons,
          armPlacement,
          setCalibrationPoints: () => {},
          armCalibrationCapture: () => {},
          setPatientMarker: () => {},
          setReplayDots: () => {},
        };
      });
      return <div data-testid="floor-plan-canvas-stub" />;
    },
  );
  return { FloorPlanCanvas };
});

import {
  BeaconPlacementCanvas,
  type BeaconPlacementCanvasHandle,
} from '@/features/beacons/BeaconPlacementCanvas';

const PATIENT = '11111111-1111-1111-1111-111111111111';
const PLAN: FloorPlanRow = {
  id: '22222222-2222-2222-2222-222222222222',
  patient_id: PATIENT,
  name: 'Floor plan',
  canvas_json: { objects: [] },
  scale_meters_per_pixel: 0.014,
  created_at: '2026-05-05T00:00:00Z',
  updated_at: '2026-05-05T00:00:00Z',
  is_active: true,
};

function beacon(overrides: Partial<BeaconRow> = {}): BeaconRow {
  return {
    id: 'b-1',
    patient_id: PATIENT,
    floor_plan_id: PLAN.id,
    mac_address: 'AA:BB:CC:DD:EE:01',
    label: 'Living room',
    x_canvas: null,
    y_canvas: null,
    tx_power: null,
    rssi_at_1m: null,
    created_at: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

function renderCanvas(beacons: BeaconRow[], floorPlan: FloorPlanRow | null = PLAN) {
  const ref = createRef<BeaconPlacementCanvasHandle>();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BeaconPlacementCanvas
        ref={ref}
        patientId={PATIENT}
        floorPlan={floorPlan}
        beacons={beacons}
      />
    </QueryClientProvider>,
  );
  return ref;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedCanvasProps.current = null;
  useUpdateBeaconPositionMock.mockReturnValue({
    mutate: mutateMock,
    isPending: false,
  });
});

describe('BeaconPlacementCanvas', () => {
  it('mirrors beacons into the canvas overlay via setBeacons on every prop change', () => {
    const beacons = [
      beacon({ id: 'b-1', label: 'Hallway', mac_address: 'AA:BB:CC:DD:EE:01' }),
      beacon({
        id: 'b-2',
        label: 'Bedroom',
        mac_address: 'AA:BB:CC:DD:EE:02',
        x_canvas: 100,
        y_canvas: 200,
      }),
    ];
    renderCanvas(beacons);
    // setBeacons fires once on mount with both sprites — placed and
    // unplaced. Unplaced (null x/y) is included so a future arm+drop
    // doesn't need a separate refresh.
    expect(capturedHandle.setBeacons).toHaveBeenCalledTimes(1);
    const sprites = capturedHandle.setBeacons.mock.calls[0]![0] as BeaconSprite[];
    expect(sprites).toHaveLength(2);
    expect(sprites[0]).toMatchObject({ id: 'b-1', label: 'Hallway', x: null, y: null });
    expect(sprites[1]).toMatchObject({ id: 'b-2', label: 'Bedroom', x: 100, y: 200 });
  });

  it('arm() forwards to the canvas armPlacement only when the id is in the list', () => {
    const ref = renderCanvas([beacon({ id: 'b-1' })]);
    act(() => {
      ref.current!.arm('b-1');
    });
    expect(capturedHandle.armPlacement).toHaveBeenLastCalledWith('b-1');

    // Stale id — should be ignored, no further armPlacement call.
    capturedHandle.armPlacement.mockClear();
    act(() => {
      ref.current!.arm('does-not-exist');
    });
    expect(capturedHandle.armPlacement).not.toHaveBeenCalled();
  });

  it('persists onBeaconUpdate from the canvas via the position mutation and disarms', () => {
    renderCanvas([beacon({ id: 'b-1' })]);
    const onBeaconUpdate = capturedCanvasProps.current?.onBeaconUpdate;
    expect(onBeaconUpdate).toBeTypeOf('function');

    act(() => {
      onBeaconUpdate!('b-1', 450, 320);
    });

    expect(mutateMock).toHaveBeenCalledWith({ id: 'b-1', x_canvas: 450, y_canvas: 320 });
    // Drop arm so a stray click after a successful placement doesn't
    // re-place the same beacon at unrelated coords.
    expect(capturedHandle.armPlacement).toHaveBeenLastCalledWith(null);
  });
});
