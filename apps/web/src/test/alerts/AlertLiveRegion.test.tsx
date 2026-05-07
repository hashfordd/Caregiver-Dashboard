import { describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import type { AlertRow } from '@alzcare/shared';
import { AlertLiveRegion } from '@/features/alerts/AlertLiveRegion';

// useAllocatedAlerts is the only data input — mock it so the live
// region renders deterministically off injected fixtures.
const mockUseAllocatedAlerts = vi.hoisted(() => vi.fn());
vi.mock('@/features/alerts/useAllocatedAlerts', () => ({
  useAllocatedAlerts: mockUseAllocatedAlerts,
}));

// Phase E item 42: AlertLiveRegion now resolves patient names via
// usePatientsLookup. Stub it to a deterministic mapping so the
// announcement copy is testable without standing up a QueryClient.
vi.mock('@/features/patients/usePatientsLookup', () => ({
  usePatientsLookup: () => ({
    byId: new Map([['11111111-2222-3333-4444-555555555555', 'Margaret Holloway']]),
    resolve: (id: string | null | undefined) =>
      id === '11111111-2222-3333-4444-555555555555' ? 'Margaret Holloway' : 'Unknown patient',
  }),
}));

function alertRow(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: crypto.randomUUID(),
    patient_id: '11111111-2222-3333-4444-555555555555',
    rule_id: null,
    severity: 'critical',
    fired_at: new Date().toISOString(),
    acknowledged_at: null,
    ack_by_caregiver_id: null,
    context: {},
    ...overrides,
  };
}

describe('AlertLiveRegion', () => {
  it('renders the assertive live region with role=alert and aria-live=assertive', () => {
    mockUseAllocatedAlerts.mockReturnValue({
      rows: [],
      unackedCount: 0,
      hasCritical: false,
      isLoading: false,
      isSuccess: true,
      isError: false,
    });
    const { container } = render(<AlertLiveRegion />);
    const assertive = container.querySelector('[role="alert"]');
    expect(assertive).not.toBeNull();
    expect(assertive?.getAttribute('aria-live')).toBe('assertive');
    const polite = container.querySelector('[role="status"]');
    expect(polite).not.toBeNull();
    expect(polite?.getAttribute('aria-live')).toBe('polite');
  });

  it('announces a newly arrived critical alert through the assertive region', () => {
    const initial = [alertRow({ severity: 'info' })];
    mockUseAllocatedAlerts.mockReturnValue({
      rows: initial,
      unackedCount: 1,
      hasCritical: false,
      isLoading: false,
      isSuccess: true,
      isError: false,
    });
    const { container, rerender } = render(<AlertLiveRegion />);
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toBe('');

    const critical = alertRow({ severity: 'critical' });
    act(() => {
      mockUseAllocatedAlerts.mockReturnValue({
        rows: [critical, ...initial],
        unackedCount: 2,
        hasCritical: true,
        isLoading: false,
        isSuccess: true,
        isError: false,
      });
      rerender(<AlertLiveRegion />);
    });
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toContain(
      'critical alert',
    );
  });
});
