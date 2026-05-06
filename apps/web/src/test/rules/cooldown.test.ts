import { describe, it, expect } from 'vitest';
import {
  cooldownSeconds,
  withinCooldown,
  type AlertRule,
  type VitalsRule,
} from '@alzcare/shared/rules';

const PATIENT = '11111111-1111-1111-1111-111111111111';

function vitalsRule(overrides: Partial<VitalsRule> = {}): VitalsRule {
  return {
    id: 'rule-1',
    patient_id: PATIENT,
    severity: 'warn',
    enabled: true,
    type: 'vitals',
    params: {
      metric: 'hr_bpm',
      min: 50,
      max: 110,
    },
    created_at: '2026-05-06T00:00:00Z',
    updated_at: '2026-05-06T00:00:00Z',
    ...overrides,
  } as VitalsRule;
}

describe('cooldownSeconds', () => {
  it('uses the severity default when no override is set', () => {
    expect(cooldownSeconds(vitalsRule({ severity: 'info' }))).toBe(15 * 60);
    expect(cooldownSeconds(vitalsRule({ severity: 'warn' }))).toBe(5 * 60);
    expect(cooldownSeconds(vitalsRule({ severity: 'critical' }))).toBe(60);
  });

  it('respects the per-rule override', () => {
    const r = vitalsRule({
      severity: 'warn',
      params: { metric: 'hr_bpm', min: 50, max: 110, cooldown_seconds: 30 },
    });
    expect(cooldownSeconds(r)).toBe(30);
  });
});

describe('withinCooldown', () => {
  const rule = vitalsRule({ severity: 'warn' });

  it('returns false when no prior firing exists', () => {
    expect(withinCooldown(rule, null, '2026-05-06T10:00:00Z')).toBe(false);
  });

  it('returns true when within the window', () => {
    expect(withinCooldown(rule, '2026-05-06T10:00:00Z', '2026-05-06T10:01:00Z')).toBe(true);
  });

  it('returns false when past the window', () => {
    // warn default = 5 min; 6 min elapsed clears.
    expect(withinCooldown(rule, '2026-05-06T10:00:00Z', '2026-05-06T10:06:00Z')).toBe(false);
  });

  it('handles a clock-skew negative delta defensively (treat as not-in-cooldown)', () => {
    expect(withinCooldown(rule, '2026-05-06T10:00:00Z', '2026-05-06T09:59:00Z')).toBe(false);
  });
});
