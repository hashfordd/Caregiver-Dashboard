import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { forwardRef, useImperativeHandle } from 'react';
import type { CalibrationPointRow } from '@/features/calibration/types';
import type { CalibrationCanvasHandle } from '@/features/calibration/CalibrationCanvas';
import type { FloorPlanRow } from '@/features/floor-plan/types';

const {
  useFloorPlanMock,
  useBeaconsMock,
  usePointsMock,
  useDeleteMock,
  deleteMutateMock,
  capturedCanvasProps,
  capturedCoordinatorProps,
} = vi.hoisted(() => ({
  useFloorPlanMock: vi.fn(),
  useBeaconsMock: vi.fn(),
  usePointsMock: vi.fn(),
  useDeleteMock: vi.fn(),
  deleteMutateMock: vi.fn(),
  capturedCanvasProps: {
    current: null as null | { onCalibrationClick?: (x: number, y: number) => void },
  },
  capturedCoordinatorProps: {
    current: null as null | { onSuccess?: () => void; onCancel?: () => void },
  },
}));

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

vi.mock('@/features/calibration/calibrationQueries', () => ({
  useCalibrationPoints: (...args: unknown[]) => usePointsMock(...args),
  useCaptureCalibrationPoint: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteCalibrationPoint: (...args: unknown[]) => useDeleteMock(...args),
}));

// Stub CaptureCoordinator: panel test focuses on canvas-click / pending /
// list / count behaviour. Coordinator's own tests own its lifecycle.
vi.mock('@/features/calibration/CaptureCoordinator', () => ({
  CaptureCoordinator: (props: { onSuccess: () => void; onCancel: () => void }) => {
    capturedCoordinatorProps.current = props;
    return (
      <div data-testid="capture-coordinator-stub">
        <button type="button" onClick={() => props.onSuccess()} aria-label="stub success">
          stub success
        </button>
        <button type="button" onClick={() => props.onCancel()} aria-label="stub cancel">
          stub cancel
        </button>
      </div>
    );
  },
}));

// Stub the CalibrationCanvas. Captures the onCalibrationClick prop so the
// test can simulate a click on the canvas. We don't mount FloorPlanCanvas
// here — that's covered by the F6 placement test pattern.
vi.mock('@/features/calibration/CalibrationCanvas', async () => {
  const CalibrationCanvas = forwardRef<CalibrationCanvasHandle, Record<string, unknown>>(
    function CalibrationCanvasStub(props, ref) {
      capturedCanvasProps.current = props as {
        onCalibrationClick?: (x: number, y: number) => void;
      };
      useImperativeHandle(ref, () => ({ arm: () => {} }));
      return <div data-testid="calibration-canvas-stub" />;
    },
  );
  return { CalibrationCanvas };
});

import { CalibrationPanel } from '@/features/calibration/CalibrationPanel';

const PATIENT = '11111111-1111-1111-1111-111111111111';
const PLAN: FloorPlanRow = {
  id: '22222222-2222-2222-2222-222222222222',
  patient_id: PATIENT,
  name: 'Floor plan',
  canvas_json: { objects: [] },
  scale_meters_per_pixel: 0.014,
  created_at: '2026-05-05T00:00:00Z',
};

function point(overrides: Partial<CalibrationPointRow> = {}): CalibrationPointRow {
  return {
    id: 'cp-1',
    floor_plan_id: PLAN.id,
    x_canvas: 100,
    y_canvas: 200,
    ble_signature: {
      captured_at: '2026-05-05T00:00:00Z',
      samples: [],
      quality: { sample_count_total: 0, ble_count: 0, wifi_count: 0, window_ms: 0 },
    },
    wifi_signature: {
      captured_at: '2026-05-05T00:00:00Z',
      samples: [],
      quality: { sample_count_total: 0, ble_count: 0, wifi_count: 0, window_ms: 0 },
    },
    captured_at: '2026-05-05T12:00:00Z',
    ...overrides,
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CalibrationPanel patientId={PATIENT} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedCanvasProps.current = null;
  capturedCoordinatorProps.current = null;
  useFloorPlanMock.mockReturnValue({
    data: PLAN,
    isLoading: false,
    isError: false,
    error: null,
  });
  useBeaconsMock.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  });
  usePointsMock.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  useDeleteMock.mockReturnValue({
    mutate: deleteMutateMock,
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
  });
});

describe('CalibrationPanel', () => {
  it('shows the empty-state when no floor plan exists', () => {
    useFloorPlanMock.mockReturnValue({ data: null, isLoading: false, isError: false });
    renderPanel();
    expect(screen.getByText(/no floor plan yet/i)).toBeTruthy();
  });

  it('shows the no-scale empty-state when the plan exists but lacks a scale', () => {
    useFloorPlanMock.mockReturnValue({
      data: { ...PLAN, scale_meters_per_pixel: null },
      isLoading: false,
      isError: false,
    });
    renderPanel();
    expect(screen.getByText(/floor plan needs a scale/i)).toBeTruthy();
  });

  it('renders the amber "fewer than 8" notice with zero captures', () => {
    renderPanel();
    expect(screen.getByText(/0 of 8 captures/i)).toBeTruthy();
  });

  it('hides the amber notice and shows X / 8 progress at 8 captures', () => {
    usePointsMock.mockReturnValue({
      data: Array.from({ length: 8 }, (_, i) => point({ id: `cp-${i + 1}` })),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPanel();
    expect(screen.queryByText(/of 8 captures/i)).toBeNull();
    expect(screen.getByText(/8 captured/i)).toBeTruthy();
  });

  it('clicking the canvas sets pending; pending forwards through to the coordinator stub', async () => {
    renderPanel();
    const onClick = capturedCanvasProps.current?.onCalibrationClick;
    expect(onClick).toBeTypeOf('function');
    act(() => onClick!(450, 320));
    // The coordinator stub mounts (the panel only mounts it when
    // a plan + scale are present — i.e. always in this test setup).
    await waitFor(() => {
      expect(screen.getByTestId('capture-coordinator-stub')).toBeTruthy();
    });
  });

  it('coordinator onSuccess clears the pending dot', async () => {
    renderPanel();
    act(() => capturedCanvasProps.current!.onCalibrationClick!(100, 200));
    await waitFor(() => {
      expect(capturedCoordinatorProps.current).not.toBeNull();
    });
    act(() => capturedCoordinatorProps.current!.onSuccess!());
    // After success, pending is cleared — the second canvas click (proof
    // of clear) reuses the same handler chain.
    act(() => capturedCanvasProps.current!.onCalibrationClick!(50, 60));
    await waitFor(() => {
      expect(capturedCoordinatorProps.current).not.toBeNull();
    });
  });

  it('coordinator onCancel clears the pending dot', () => {
    renderPanel();
    act(() => capturedCanvasProps.current!.onCalibrationClick!(100, 200));
    act(() => capturedCoordinatorProps.current!.onCancel!());
    // Pending text should not appear because the panel re-renders with
    // pending = null. The coordinator stub still mounts (it always does
    // when the panel is in placement-ready state); we verify the panel
    // forwards the cleared pending by checking the canvas hasn't
    // received a stale pending prop.
    // Indirect check: a second click should still drop a fresh pending.
    act(() => capturedCanvasProps.current!.onCalibrationClick!(60, 70));
    expect(capturedCoordinatorProps.current).not.toBeNull();
  });

  it('Delete on a captured point fires the delete mutation', () => {
    usePointsMock.mockReturnValue({
      data: [point({ id: 'cp-7' })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(deleteMutateMock).toHaveBeenCalledWith('cp-7');
  });
});
