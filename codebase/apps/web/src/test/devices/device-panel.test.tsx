import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { orderMock, updateEqMock, updateMock } = vi.hoisted(() => ({
  orderMock: vi.fn(),
  updateEqMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ order: orderMock })),
      })),
      update: updateMock,
    })),
    rpc: vi.fn(),
  },
}));

import { DevicePairingPanel } from '@/features/devices/DevicePairingPanel';

const PATIENT = '11111111-1111-1111-1111-111111111111';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DevicePairingPanel patientId={PATIENT} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  orderMock.mockReset();
  updateMock.mockReset();
  updateEqMock.mockReset();
  updateMock.mockReturnValue({ eq: updateEqMock });
});

describe('DevicePairingPanel', () => {
  it('renders the empty state when no devices are paired', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    renderPanel();
    expect(await screen.findByText(/no devices paired yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pair device/i })).toBeInTheDocument();
  });

  it('renders one row per device with mac, label, and heartbeat', async () => {
    orderMock.mockResolvedValue({
      data: [
        {
          id: 'd-1',
          mac_address: 'aa:bb:cc:dd:ee:ff',
          firmware_version: null,
          label: 'wrist left',
          paired_patient_id: PATIENT,
          last_seen_at: null,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'd-2',
          mac_address: '11:22:33:44:55:66',
          firmware_version: null,
          label: null,
          paired_patient_id: PATIENT,
          last_seen_at: new Date(Date.now() - 12_000).toISOString(),
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      error: null,
    });
    renderPanel();

    expect(await screen.findByText('aa:bb:cc:dd:ee:ff')).toBeInTheDocument();
    expect(screen.getByText('11:22:33:44:55:66')).toBeInTheDocument();
    expect(screen.getByText('wrist left')).toBeInTheDocument();
    expect(screen.getByText(/last seen: never/i)).toBeInTheDocument();
    expect(screen.getByText(/last seen: 1[1-3]s ago/i)).toBeInTheDocument();
  });

  it('clicking Unpair calls update({ paired_patient_id: null }).eq("id", deviceId)', async () => {
    orderMock.mockResolvedValue({
      data: [
        {
          id: 'd-1',
          mac_address: 'aa:bb:cc:dd:ee:ff',
          firmware_version: null,
          label: null,
          paired_patient_id: PATIENT,
          last_seen_at: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      error: null,
    });
    updateEqMock.mockResolvedValue({ error: null });

    renderPanel();
    await screen.findByText('aa:bb:cc:dd:ee:ff');

    fireEvent.click(screen.getByRole('button', { name: /unpair/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith({ paired_patient_id: null });
    expect(updateEqMock).toHaveBeenCalledWith('id', 'd-1');
  });
});
