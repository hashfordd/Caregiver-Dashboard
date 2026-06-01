import { describe, expect, it } from 'vitest';
import type { AlertRow } from '@alzcare/shared';
import { pickBannerAlert } from '@/features/alerts/AlertBanner';
import { pickCriticalAlerts } from '@/features/alerts/CriticalAlertOverlay';

function alert(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: crypto.randomUUID(),
    patient_id: '11111111-1111-1111-1111-111111111111',
    rule_id: null,
    severity: 'warn',
    fired_at: '2026-06-01T10:00:00.000Z',
    acknowledged_at: null,
    ack_by_caregiver_id: null,
    context: {},
    ...overrides,
  };
}

describe('pickBannerAlert (amber under-header channel)', () => {
  it('never surfaces critical alerts — those go to the overlay', () => {
    const rows = [alert({ severity: 'critical' })];
    expect(pickBannerAlert(rows)).toBeNull();
  });

  it('prefers warn over info, then most recent', () => {
    const info = alert({ severity: 'info' });
    const warnOld = alert({ severity: 'warn', fired_at: '2026-06-01T09:00:00.000Z' });
    const warnNew = alert({ severity: 'warn', fired_at: '2026-06-01T11:00:00.000Z' });
    expect(pickBannerAlert([info, warnOld, warnNew])?.fired_at).toBe('2026-06-01T11:00:00.000Z');
  });

  it('falls back to info when no warn exists', () => {
    const info = alert({ severity: 'info' });
    expect(pickBannerAlert([info])?.severity).toBe('info');
  });
});

describe('pickCriticalAlerts (full-screen red channel)', () => {
  it('returns only unacked criticals, newest first', () => {
    const c1 = alert({ severity: 'critical', fired_at: '2026-06-01T09:00:00.000Z' });
    const c2 = alert({ severity: 'critical', fired_at: '2026-06-01T12:00:00.000Z' });
    const ackedCrit = alert({
      severity: 'critical',
      acknowledged_at: '2026-06-01T12:30:00.000Z',
    });
    const warn = alert({ severity: 'warn' });
    const picked = pickCriticalAlerts([c1, c2, ackedCrit, warn]);
    expect(picked).toHaveLength(2);
    expect(picked[0]?.fired_at).toBe('2026-06-01T12:00:00.000Z');
  });

  it('is empty when there are no unacked criticals', () => {
    expect(pickCriticalAlerts([alert({ severity: 'warn' })])).toEqual([]);
  });
});
