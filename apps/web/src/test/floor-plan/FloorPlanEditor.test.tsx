import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { forwardRef, useImperativeHandle } from 'react';
import type { FloorPlanCanvasHandle, FloorPlanRow } from '@/features/floor-plan/types';

const { useFloorPlanMock, useCalibrationCountMock, useUpsertFloorPlanMock, mutateAsyncMock } =
  vi.hoisted(() => ({
    useFloorPlanMock: vi.fn(),
    useCalibrationCountMock: vi.fn(),
    useUpsertFloorPlanMock: vi.fn(),
    mutateAsyncMock: vi.fn(),
  }));

vi.mock('@/features/floor-plan/floorPlanQueries', () => ({
  useFloorPlan: (...args: unknown[]) => useFloorPlanMock(...args),
  useCalibrationCount: (...args: unknown[]) => useCalibrationCountMock(...args),
  useUpsertFloorPlan: (...args: unknown[]) => useUpsertFloorPlanMock(...args),
}));

// Replace the Fabric-backed canvas with a stub that exposes the same imperative
// handle. Avoids loading Fabric in jsdom and keeps tests focused on the
// editor's orchestration.
vi.mock('@/features/floor-plan/FloorPlanCanvas', () => {
  const FloorPlanCanvas = forwardRef<
    FloorPlanCanvasHandle,
    {
      onDirty?: () => void;
      onIsEmptyChange?: (empty: boolean) => void;
    }
  >(({ onDirty, onIsEmptyChange }, ref) => {
    useImperativeHandle(ref, () => ({
      setMode: () => {},
      setFurnitureKind: () => {},
      serialize: () => ({ objects: [{ type: 'rect' }] }),
      deserialize: async () => {},
      getSelectedLinePixelLength: () => 200,
      deleteSelected: () => {},
      countObjects: () => ({ walls: 0, rooms: 0, furniture: 1 }),
      undo: () => {},
      redo: () => {},
      fitToContent: () => {},
      setSelectedWallLength: () => {},
    }));
    return (
      <div data-testid="floor-plan-canvas">
        <button type="button" onClick={onDirty} aria-label="mark dirty">
          mark dirty
        </button>
        <button type="button" onClick={() => onIsEmptyChange?.(false)} aria-label="mark non-empty">
          mark non-empty
        </button>
      </div>
    );
  });
  return { FloorPlanCanvas };
});

import { FloorPlanEditor } from '@/features/floor-plan/FloorPlanEditor';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_ID = '22222222-2222-2222-2222-222222222222';

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FloorPlanEditor patientId={PATIENT_ID} />
    </QueryClientProvider>,
  );
}

function plan(overrides: Partial<FloorPlanRow> = {}): FloorPlanRow {
  return {
    id: PLAN_ID,
    patient_id: PATIENT_ID,
    name: 'Floor plan',
    canvas_json: { objects: [] },
    scale_meters_per_pixel: null,
    created_at: '2026-05-04T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  useFloorPlanMock.mockReset();
  useCalibrationCountMock.mockReset();
  useUpsertFloorPlanMock.mockReset();
  mutateAsyncMock.mockReset();

  useCalibrationCountMock.mockReturnValue({ data: 0 });
  useUpsertFloorPlanMock.mockReturnValue({
    mutateAsync: mutateAsyncMock,
    isPending: false,
    isError: false,
    error: null,
  });
});

describe('FloorPlanEditor', () => {
  it('renders the loading skeleton while the plan query is pending', () => {
    useFloorPlanMock.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { container } = renderEditor();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('renders the error card with a retry button when the plan query fails', () => {
    const refetch = vi.fn();
    useFloorPlanMock.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch,
      data: undefined,
    });
    renderEditor();
    expect(screen.getByText(/couldn't load the floor plan/i)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the empty-state pep-talk when no plan exists yet', () => {
    useFloorPlanMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: null,
    });
    renderEditor();
    expect(screen.getByText(/a blank canvas/i)).toBeInTheDocument();
    expect(screen.getByTestId('floor-plan-canvas')).toBeInTheDocument();
  });

  it('save is disabled until the canvas signals dirty, then upserts on click', async () => {
    useFloorPlanMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: plan(),
    });
    mutateAsyncMock.mockResolvedValue(plan({ created_at: '2026-05-04T12:34:56Z' }));

    renderEditor();

    // Floor plan starts read-only — click Edit to unlock the toolbar.
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /mark dirty/i }));
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PLAN_ID,
        patient_id: PATIENT_ID,
        canvas_json: { objects: [{ type: 'rect' }] },
        scale_meters_per_pixel: null,
      }),
    );
    expect(await screen.findByText(/^Saved · /)).toBeInTheDocument();
  });

  it('opens the calibration warning before saving when calibration points exist', async () => {
    useFloorPlanMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: plan(),
    });
    useCalibrationCountMock.mockReturnValue({ data: 3 });

    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark dirty/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/calibration may be stale/i)).toBeInTheDocument();
    expect(screen.getByText(/3 calibration points/i)).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();

    mutateAsyncMock.mockResolvedValue(plan({ created_at: '2026-05-04T12:34:56Z' }));
    fireEvent.click(screen.getByRole('button', { name: /save anyway/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
  });
});
