import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';

const { useUpsertBeaconMock, mutateAsyncMock } = vi.hoisted(() => ({
  useUpsertBeaconMock: vi.fn(),
  mutateAsyncMock: vi.fn(),
}));

vi.mock('@/features/beacons/beaconQueries', () => ({
  useUpsertBeacon: (...args: unknown[]) => useUpsertBeaconMock(...args),
  useBeacons: vi.fn(),
  useUpdateBeaconPosition: vi.fn(),
  useDeleteBeacon: vi.fn(),
}));

import { PairDialog } from '@/features/beacons/PairDialog';

const PATIENT = '11111111-1111-1111-1111-111111111111';
const PLAN = '22222222-2222-2222-2222-222222222222';
const MAC = 'AA:BB:CC:DD:EE:01';

function renderDialog(overrides: Partial<React.ComponentProps<typeof PairDialog>> = {}) {
  const onOpenChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PairDialog
        open
        onOpenChange={onOpenChange}
        mac={MAC}
        patientId={PATIENT}
        floorPlanId={PLAN}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDiscoveredBeaconsStore.getState().reset(PATIENT);
  // Seed the store so we can verify forget() is called on success.
  useDiscoveredBeaconsStore.getState().pushSample(PATIENT, MAC, -60);
  useUpsertBeaconMock.mockReturnValue({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  });
});

describe('PairDialog', () => {
  it('submits the trimmed label, closes, and forgets the MAC on success', async () => {
    mutateAsyncMock.mockResolvedValue({ id: 'beacon-1' });
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: '  Living room  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^pair$/i }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        patient_id: PATIENT,
        floor_plan_id: PLAN,
        mac_address: MAC,
        label: 'Living room',
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(useDiscoveredBeaconsStore.getState().cards[PATIENT]?.[MAC]).toBeUndefined();
  });

  it('surfaces a friendly message when the insert hits a 23505 unique violation', async () => {
    mutateAsyncMock.mockRejectedValue({ code: '23505', message: 'duplicate key value' });
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Hallway' } });
    fireEvent.click(screen.getByRole('button', { name: /^pair$/i }));

    expect(await screen.findByText(/already paired/i)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Discovery store still holds the MAC — caregiver can dismiss + retry.
    expect(useDiscoveredBeaconsStore.getState().cards[PATIENT]?.[MAC]).toBeDefined();
  });

  it('keeps the Pair button disabled until a label is entered', () => {
    renderDialog();
    const submit = screen.getByRole('button', { name: /^pair$/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Bedroom' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });
});
