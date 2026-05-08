import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AlertRow } from '@alzcare/shared';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}));

import { AckButton } from '@/features/alerts/AckButton';

const PATIENT = '11111111-1111-1111-1111-111111111111';

function alert(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: 'alert-1',
    patient_id: PATIENT,
    rule_id: 'rule-1',
    severity: 'warn',
    fired_at: '2026-05-06T10:00:00Z',
    acknowledged_at: null,
    ack_by_caregiver_id: null,
    context: { kind: 'vitals', metric: 'hr_bpm', value: 200 },
    ...overrides,
  };
}

function renderWith(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>), qc };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AckButton', () => {
  it('renders an Acknowledge button when the alert is unacked', () => {
    renderWith(<AckButton alert={alert()} />);
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeTruthy();
  });

  it('calls the RPC and surfaces the acked state on success', async () => {
    rpcMock.mockResolvedValue({
      data: { ...alert(), acknowledged_at: '2026-05-06T10:01:00Z' },
      error: null,
    });
    const onAcked = vi.fn();
    renderWith(<AckButton alert={alert()} onAcked={onAcked} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    });
    expect(rpcMock).toHaveBeenCalledWith('acknowledge_alert', { p_alert_id: 'alert-1' });
    expect(onAcked).toHaveBeenCalledTimes(1);
  });

  it('shows the acknowledged state when alert.acknowledged_at is set', () => {
    renderWith(<AckButton alert={alert({ acknowledged_at: '2026-05-06T10:01:00Z' })} />);
    expect(screen.getByText(/acknowledged/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /acknowledge/i })).toBeNull();
  });
});
