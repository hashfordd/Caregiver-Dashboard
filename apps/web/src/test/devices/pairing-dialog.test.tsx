import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}));

import { PairDeviceDialog } from '@/features/devices/PairDeviceDialog';

const PATIENT = '11111111-1111-1111-1111-111111111111';

function renderDialog(onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <PairDeviceDialog open={true} onOpenChange={onOpenChange} patientId={PATIENT} />
      </QueryClientProvider>,
    ),
    qc,
    onOpenChange,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe('PairDeviceDialog', () => {
  it('rejects an invalid MAC address with a Zod validation error', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/mac address/i), {
      target: { value: 'not-a-mac' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^pair$/i }));
    expect(await screen.findByText(/expected mac like/i)).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('calls pair_device RPC with normalised lowercased MAC and closes on success', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: 'd-1',
        mac_address: 'aa:bb:cc:dd:ee:ff',
        firmware_version: null,
        label: 'wrist left',
        paired_patient_id: PATIENT,
        last_seen_at: null,
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    const { qc, onOpenChange } = renderDialog();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    fireEvent.change(screen.getByLabelText(/mac address/i), {
      target: { value: 'AA:BB:CC:DD:EE:FF' },
    });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'wrist left' } });
    fireEvent.click(screen.getByRole('button', { name: /^pair$/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('pair_device', {
      p_mac_address: 'aa:bb:cc:dd:ee:ff',
      p_patient_id: PATIENT,
      p_label: 'wrist left',
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['devices', PATIENT] });
  });

  it('renders the RPC error inline (paired-elsewhere) and keeps the dialog open', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'device already paired to another patient' },
    });
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText(/mac address/i), {
      target: { value: 'aa:bb:cc:dd:ee:ff' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^pair$/i }));

    expect(
      await screen.findByText(/device already paired to another patient/i),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
