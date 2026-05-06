import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BeaconRow } from '@/features/beacons/types';

const { useBeaconsMock, useDeleteBeaconMock, deleteMutateMock, useFloorPlanMock } = vi.hoisted(
  () => ({
    useBeaconsMock: vi.fn(),
    useDeleteBeaconMock: vi.fn(),
    deleteMutateMock: vi.fn(),
    useFloorPlanMock: vi.fn(),
  }),
);

// BeaconsPanel imports @/lib/devSignals, which eagerly evaluates
// @/lib/supabase. That throws in CI (no VITE_SUPABASE_* env vars), so
// stub the supabase client like the other component tests do.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock('@/features/beacons/beaconQueries', () => ({
  useBeacons: (...args: unknown[]) => useBeaconsMock(...args),
  useDeleteBeacon: (...args: unknown[]) => useDeleteBeaconMock(...args),
  useUpsertBeacon: vi.fn(),
  useUpdateBeaconPosition: vi.fn(),
}));

// BeaconsPanel reads the patient's active floor plan to pass its id into
// the pair dialog. Tests don't open the dialog, but the hook still runs
// at the top of the component — return an empty query stub.
vi.mock('@/features/floor-plan/floorPlanQueries', () => ({
  useFloorPlan: (...args: unknown[]) => useFloorPlanMock(...args),
  useUpsertFloorPlan: vi.fn(),
  useCalibrationCount: vi.fn(),
}));

import { BeaconsPanel } from '@/features/beacons/BeaconsPanel';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

function beacon(overrides: Partial<BeaconRow> = {}): BeaconRow {
  return {
    id: 'beacon-1',
    patient_id: PATIENT_ID,
    floor_plan_id: null,
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

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BeaconsPanel patientId={PATIENT_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useDeleteBeaconMock.mockReturnValue({
    mutate: deleteMutateMock,
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
  });
  useFloorPlanMock.mockReturnValue({
    data: null,
    isLoading: false,
    isError: false,
    error: null,
  });
});

describe('BeaconsPanel', () => {
  it('shows empty state when no beacons exist', () => {
    useBeaconsMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [],
      error: null,
      refetch: vi.fn(),
    });
    renderPanel();
    expect(screen.getByText(/no beacons paired yet/i)).toBeTruthy();
  });

  it('renders a card per beacon with label and MAC, marking unplaced', () => {
    useBeaconsMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        beacon({ id: 'b-1', label: 'Hallway', mac_address: 'AA:BB:CC:DD:EE:01' }),
        beacon({
          id: 'b-2',
          label: 'Bedroom',
          mac_address: 'AA:BB:CC:DD:EE:02',
          x_canvas: 100,
          y_canvas: 200,
        }),
      ],
      error: null,
      refetch: vi.fn(),
    });
    renderPanel();
    expect(screen.getByText('Hallway')).toBeTruthy();
    expect(screen.getByText('AA:BB:CC:DD:EE:01')).toBeTruthy();
    expect(screen.getByText('Bedroom')).toBeTruthy();
    // Only the unplaced one (b-1) carries the badge.
    const badges = screen.getAllByText(/unplaced/i);
    expect(badges).toHaveLength(1);
  });

  it('clicking delete calls the mutate hook with the beacon id', () => {
    useBeaconsMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [beacon({ id: 'b-1', label: 'Hallway' })],
      error: null,
      refetch: vi.fn(),
    });
    renderPanel();
    fireEvent.click(screen.getByLabelText(/delete beacon hallway/i));
    expect(deleteMutateMock).toHaveBeenCalledWith('b-1');
  });

  it('renders skeleton during initial load', () => {
    useBeaconsMock.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderPanel();
    // Skeleton components render with role-less divs; assert by class hook.
    expect(container.querySelector('[data-slot="skeleton"], .animate-pulse')).toBeTruthy();
  });

  it('surfaces a refetch button on load error', () => {
    const refetch = vi.fn();
    useBeaconsMock.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error('boom'),
      refetch,
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
