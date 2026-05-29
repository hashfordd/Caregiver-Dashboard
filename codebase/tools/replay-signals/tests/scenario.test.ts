import { describe, it, expect } from 'vitest';
import {
  summariseOutcomes,
  validateScenarioExpectations,
  type AlertLike,
  type ScenarioExpectation,
} from '../lib/scenario';

const RULE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RULE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function alert(overrides: Partial<AlertLike> = {}): AlertLike {
  return {
    id: 'alert-' + Math.random().toString(36).slice(2, 9),
    rule_id: RULE_A,
    severity: 'warn',
    context: {},
    ...overrides,
  };
}

describe('validateScenarioExpectations — must_fire=true', () => {
  it('passes when at least min_count alerts fire for the rule', () => {
    const exp: ScenarioExpectation[] = [
      { name: 'entered bedroom', rule_id: RULE_A, must_fire: true, min_count: 1 },
    ];
    const outcomes = validateScenarioExpectations(exp, [alert(), alert()]);
    expect(outcomes[0]!.pass).toBe(true);
    expect(outcomes[0]!.observed).toBe(2);
  });

  it('fails when fewer than min_count alerts fire', () => {
    const exp: ScenarioExpectation[] = [
      { name: 'entered bedroom twice', rule_id: RULE_A, must_fire: true, min_count: 2 },
    ];
    const outcomes = validateScenarioExpectations(exp, [alert()]);
    expect(outcomes[0]!.pass).toBe(false);
    expect(outcomes[0]!.failures[0]).toMatch(/at least 2/);
  });

  it('enforces severity when present', () => {
    const exp: ScenarioExpectation[] = [
      { name: 'critical only', rule_id: RULE_A, must_fire: true, severity: 'critical' },
    ];
    const outcomes = validateScenarioExpectations(exp, [alert({ severity: 'warn' })]);
    expect(outcomes[0]!.pass).toBe(false);
    expect(outcomes[0]!.failures.join(' ')).toMatch(/severity/);
  });

  it('matches context substring when supplied', () => {
    const exp: ScenarioExpectation[] = [
      { name: 'door near front', rule_id: RULE_A, must_fire: true, context_contains: 'front-door' },
    ];
    const hit = alert({ context: { connector_id: 'front-door' } });
    const miss = alert({ context: { connector_id: 'back-door' } });
    expect(validateScenarioExpectations(exp, [hit])[0]!.pass).toBe(true);
    expect(validateScenarioExpectations(exp, [miss])[0]!.pass).toBe(false);
  });
});

describe('validateScenarioExpectations — must_fire=false', () => {
  it('passes when no matching alerts fired', () => {
    const exp: ScenarioExpectation[] = [
      { name: 'no door proximity', rule_id: RULE_B, must_fire: false },
    ];
    const outcomes = validateScenarioExpectations(exp, [alert({ rule_id: RULE_A })]);
    expect(outcomes[0]!.pass).toBe(true);
    expect(outcomes[0]!.observed).toBe(0);
  });

  it('fails when the rule fired at all', () => {
    const exp: ScenarioExpectation[] = [
      { name: 'no door proximity', rule_id: RULE_B, must_fire: false },
    ];
    const outcomes = validateScenarioExpectations(exp, [alert({ rule_id: RULE_B })]);
    expect(outcomes[0]!.pass).toBe(false);
    expect(outcomes[0]!.failures[0]).toMatch(/expected.*NOT/);
  });
});

describe('summariseOutcomes', () => {
  it('aggregates passes and failures into a single verdict', () => {
    const outcomes = validateScenarioExpectations(
      [
        { name: 'a', rule_id: RULE_A, must_fire: true },
        { name: 'b', rule_id: RULE_B, must_fire: false },
      ],
      [alert(), alert({ rule_id: RULE_B })],
    );
    const summary = summariseOutcomes(outcomes);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pass).toBe(false);
  });
});
