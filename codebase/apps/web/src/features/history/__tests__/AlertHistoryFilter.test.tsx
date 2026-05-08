import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AlertHistoryFilter } from '../AlertHistoryFilter';
import type { AlertHistoryRow } from '../types';
import * as historyQueries from '@/lib/queries/history';

// ---------------------------------------------------------------------------
// Fixture: 30 alerts — 10 critical/fall, 10 warn/vitals, 5 info/zone, 5 warn/inactivity.
// ---------------------------------------------------------------------------

function makeRow(
  i: number,
  severity: AlertHistoryRow['severity'],
  rule_type: AlertHistoryRow['rule_type'],
  firedAtMs: number,
): AlertHistoryRow {
  return {
    id: `alert-${i}`,
    patient_id: 'patient-1',
    rule_id: `rule-${i}`,
    rule_type,
    severity,
    fired_at: new Date(firedAtMs).toISOString(),
    acknowledged_at: null,
    ack_by_caregiver_id: null,
    context: { msg: `alert ${i}` },
  };
}

const BASE_MS = 1_700_000_000_000;

function buildFixture(): AlertHistoryRow[] {
  const rows: AlertHistoryRow[] = [];
  // 0–9: critical / fall — minutes 0..9
  for (let i = 0; i < 10; i++) {
    rows.push(makeRow(i, 'critical', 'fall', BASE_MS + i * 60_000));
  }
  // 10–19: warn / vitals — minutes 10..19
  for (let i = 0; i < 10; i++) {
    rows.push(makeRow(10 + i, 'warn', 'vitals', BASE_MS + (10 + i) * 60_000));
  }
  // 20–24: info / zone — minutes 20..24
  for (let i = 0; i < 5; i++) {
    rows.push(makeRow(20 + i, 'info', 'zone', BASE_MS + (20 + i) * 60_000));
  }
  // 25–29: warn / inactivity — minutes 25..29
  for (let i = 0; i < 5; i++) {
    rows.push(makeRow(25 + i, 'warn', 'inactivity', BASE_MS + (25 + i) * 60_000));
  }
  return rows;
}

const FIXTURE = buildFixture();

// "First half": fired_at < BASE_MS + 15 min → rows 0–9 (critical/fall) + rows 10–14 (warn/vitals) = 15 rows.
const FIRST_HALF = FIXTURE.filter((r) => new Date(r.fired_at).getTime() < BASE_MS + 15 * 60_000);

// ---------------------------------------------------------------------------
// Module mock: replace useAlertHistory with a spy; keep filterAlerts real.
// ---------------------------------------------------------------------------
vi.mock('@/lib/queries/history', async (importOriginal) => {
  const original = await importOriginal<typeof historyQueries>();
  return {
    ...original,
    useAlertHistory: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const DEFAULT_RANGE = {
  preset: '24h' as const,
  from: new Date(BASE_MS).toISOString(),
  to: new Date(BASE_MS + 30 * 60_000).toISOString(),
};

function renderFilter(rows: AlertHistoryRow[] = FIXTURE) {
  vi.mocked(historyQueries.useAlertHistory).mockReturnValue({
    data: rows,
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof historyQueries.useAlertHistory>);

  render(
    <QueryClientProvider client={makeQueryClient()}>
      <AlertHistoryFilter patientId="patient-1" range={DEFAULT_RANGE} />
    </QueryClientProvider>,
  );
}

function tableRows() {
  const tbody = document.querySelector('tbody');
  if (!tbody) return [];
  return within(tbody as HTMLElement).getAllByRole('row');
}

function clickChip(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

// ---------------------------------------------------------------------------
// AlertHistoryFilter rendering tests
// ---------------------------------------------------------------------------

describe('AlertHistoryFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. no filters (default all-on) → all 30 rows visible', () => {
    renderFilter();
    expect(tableRows()).toHaveLength(30);
  });

  it('2. severity = critical only → only the 10 critical rows', () => {
    renderFilter();
    clickChip('warn');
    clickChip('info');
    const rows = tableRows();
    expect(rows).toHaveLength(10);
    rows.forEach((row) => {
      expect(within(row).getByText('critical')).toBeInTheDocument();
    });
  });

  it('3. rule type = fall only → only the 10 fall rows', () => {
    renderFilter();
    clickChip('vitals');
    clickChip('zone');
    clickChip('inactivity');
    expect(tableRows()).toHaveLength(10);
  });

  it('4. severity = warn AND rule type = vitals → 10-row intersection', () => {
    renderFilter();
    clickChip('critical');
    clickChip('info');
    clickChip('zone');
    clickChip('fall');
    clickChip('inactivity');
    expect(tableRows()).toHaveLength(10);
  });

  it('5. date range narrowed to first half → 15 rows (hook mocks server-side predicate)', () => {
    renderFilter(FIRST_HALF);
    expect(tableRows()).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// filterAlerts pure-function tests — no rendering needed.
// ---------------------------------------------------------------------------

describe('filterAlerts', () => {
  type Filters = Parameters<typeof historyQueries.filterAlerts>[1];

  const allOn: Filters = {
    severities: new Set(['info', 'warn', 'critical']),
    ruleTypes: new Set(['zone', 'vitals', 'fall', 'inactivity']),
  };

  it('default all-on filters return all 30 rows', () => {
    expect(historyQueries.filterAlerts(FIXTURE, allOn)).toHaveLength(30);
  });

  it('critical severity returns 10 rows', () => {
    const f: Filters = { ...allOn, severities: new Set(['critical']) };
    const result = historyQueries.filterAlerts(FIXTURE, f);
    expect(result).toHaveLength(10);
    result.forEach((r) => expect(r.severity).toBe('critical'));
  });

  it('fall rule type returns 10 rows', () => {
    const f: Filters = { ...allOn, ruleTypes: new Set(['fall']) };
    const result = historyQueries.filterAlerts(FIXTURE, f);
    expect(result).toHaveLength(10);
    result.forEach((r) => expect(r.rule_type).toBe('fall'));
  });

  it('warn + vitals intersection returns 10 rows', () => {
    const f: Filters = { severities: new Set(['warn']), ruleTypes: new Set(['vitals']) };
    const result = historyQueries.filterAlerts(FIXTURE, f);
    expect(result).toHaveLength(10);
    result.forEach((r) => {
      expect(r.severity).toBe('warn');
      expect(r.rule_type).toBe('vitals');
    });
  });
});
