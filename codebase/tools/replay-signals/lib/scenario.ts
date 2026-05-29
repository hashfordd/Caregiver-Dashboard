// Phase D: scenario-validation harness logic. Pure functions for the
// comparison step so they can be unit-tested without driving the bridge.

export interface ScenarioExpectation {
  /** Human-readable label included in the report. */
  name: string;
  /** Rule id the alert should reference. */
  rule_id: string;
  /** When true, at least `min_count` alerts must fire for the rule.
   *  When false, the rule must NOT fire — useful for "this scenario
   *  should not trigger this rule" assertions. */
  must_fire: boolean;
  /** Minimum number of alerts required when must_fire is true.
   *  Defaults to 1 if omitted. Ignored when must_fire is false. */
  min_count?: number;
  /** Optional severity to enforce. When set, every observed alert for
   *  this rule must match. */
  severity?: 'info' | 'warn' | 'critical';
  /** Optional substring to look for in JSON-stringified context. Useful
   *  for differentiating two enter-rules on different rooms when the
   *  scenario seeds them both. */
  context_contains?: string;
}

export interface AlertLike {
  id: string;
  rule_id: string | null;
  severity: 'info' | 'warn' | 'critical';
  context: Record<string, unknown>;
}

export interface ScenarioFile {
  /** Path (absolute or relative to the scenario file) of the SignalsMessage fixture. */
  fixture: string;
  /** Patient id used to scope the alerts query. */
  patientId: string;
  /** Per-expectation matchers — order does not matter. */
  expectations: ScenarioExpectation[];
  /** Milliseconds to wait after the last fixture post before querying. */
  drainMs?: number;
}

export interface ExpectationOutcome {
  name: string;
  rule_id: string;
  expected: 'fires' | 'does_not_fire';
  observed: number;
  required: number | null;
  pass: boolean;
  failures: string[];
}

/** Compare a list of fired alerts against the scenario's expectations.
 *  Returns one outcome per expectation; `pass: false` outcomes carry a
 *  human-readable `failures` list so the caller can surface them. */
export function validateScenarioExpectations(
  expectations: ScenarioExpectation[],
  alerts: AlertLike[],
): ExpectationOutcome[] {
  const outcomes: ExpectationOutcome[] = [];
  for (const exp of expectations) {
    const matched = alerts.filter((a) => a.rule_id === exp.rule_id);
    const failures: string[] = [];

    if (exp.must_fire) {
      const required = Math.max(1, Math.floor(exp.min_count ?? 1));
      if (matched.length < required) {
        failures.push(
          `expected at least ${required} alert(s) for rule ${exp.rule_id}, got ${matched.length}`,
        );
      }
      if (exp.severity) {
        const wrong = matched.filter((a) => a.severity !== exp.severity);
        if (wrong.length > 0) {
          failures.push(
            `expected severity ${exp.severity}; ${wrong.length} alert(s) had a different severity`,
          );
        }
      }
      if (exp.context_contains) {
        const ok = matched.some((a) => JSON.stringify(a.context).includes(exp.context_contains!));
        if (!ok) {
          failures.push(`no alert's context contained substring "${exp.context_contains}"`);
        }
      }
      outcomes.push({
        name: exp.name,
        rule_id: exp.rule_id,
        expected: 'fires',
        observed: matched.length,
        required,
        pass: failures.length === 0,
        failures,
      });
    } else {
      if (matched.length > 0) {
        failures.push(
          `expected rule ${exp.rule_id} to NOT fire; ${matched.length} alert(s) observed`,
        );
      }
      outcomes.push({
        name: exp.name,
        rule_id: exp.rule_id,
        expected: 'does_not_fire',
        observed: matched.length,
        required: null,
        pass: failures.length === 0,
        failures,
      });
    }
  }
  return outcomes;
}

export function summariseOutcomes(outcomes: ExpectationOutcome[]): {
  passed: number;
  failed: number;
  pass: boolean;
} {
  let passed = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.pass) passed += 1;
    else failed += 1;
  }
  return { passed, failed, pass: failed === 0 };
}
