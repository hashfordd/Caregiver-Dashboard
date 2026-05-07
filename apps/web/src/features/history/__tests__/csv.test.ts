import { describe, expect, it } from 'vitest';
import { alertRowsToCsv, positionRowsToCsv, vitalsRowsToCsv } from '../csv';
import type { AlertHistoryRow, PositionHistoryRow, VitalsHistoryRow } from '../types';

// ── shared helpers ──────────────────────────────────────────────────────────

const TS = '2025-01-01T00:00:00.000Z';

function makeVitals(overrides?: Partial<VitalsHistoryRow>): VitalsHistoryRow {
  return { recorded_at: TS, hr_bpm: 72, spo2_pct: 98, temp_c: 36.6, ...overrides };
}

function makePosition(overrides?: Partial<PositionHistoryRow>): PositionHistoryRow {
  return {
    recorded_at: TS,
    mode: 'indoor',
    x_canvas: 100,
    y_canvas: 200,
    lat: null,
    lng: null,
    confidence: 0.9,
    ...overrides,
  };
}

function makeAlert(overrides?: Partial<AlertHistoryRow>): AlertHistoryRow {
  return {
    id: 'a1',
    patient_id: 'p1',
    rule_id: 'r1',
    rule_type: 'vitals',
    severity: 'warn',
    fired_at: TS,
    acknowledged_at: null,
    ack_by_caregiver_id: null,
    context: {},
    ...overrides,
  };
}

// ── 1. Header row matches the documented column order ───────────────────────

describe('header row', () => {
  it('vitals header matches documented order', () => {
    const csv = vitalsRowsToCsv([]);
    expect(csv.split('\r\n')[0]).toBe('recorded_at,hr_bpm,spo2_pct,temp_c');
  });

  it('positions header matches documented order', () => {
    const csv = positionRowsToCsv([]);
    expect(csv.split('\r\n')[0]).toBe('recorded_at,mode,x_canvas,y_canvas,lat,lng,confidence');
  });

  it('alerts header matches documented order', () => {
    const csv = alertRowsToCsv([]);
    expect(csv.split('\r\n')[0]).toBe(
      'fired_at,severity,rule_type,acknowledged_at,ack_by_caregiver_id',
    );
  });
});

// ── 2. Numeric cells unquoted; null cells are empty fields ──────────────────

describe('numerics and nulls', () => {
  it('numeric cells appear unquoted', () => {
    const csv = vitalsRowsToCsv([makeVitals({ hr_bpm: 60, spo2_pct: 99, temp_c: 37.1 })]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toBe(`${TS},60,99,37.1`);
  });

  it('null cells produce empty fields (adjacent commas)', () => {
    const csv = vitalsRowsToCsv([makeVitals({ hr_bpm: null, spo2_pct: null, temp_c: null })]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toBe(`${TS},,,`);
  });

  it('null indoor coords produce empty lat/lng fields', () => {
    const csv = positionRowsToCsv([makePosition({ lat: null, lng: null })]);
    const dataRow = csv.split('\r\n')[1];
    // x_canvas,y_canvas present; lat,lng empty
    expect(dataRow).toContain(',,');
  });
});

// ── 3. String cells with comma are quoted ───────────────────────────────────

describe('quoting: comma in string', () => {
  it('mode value containing comma is quoted', () => {
    // mode is an enum in practice; force a pathological string via cast
    const csv = positionRowsToCsv([makePosition({ mode: 'a,b' as 'indoor' })]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toContain('"a,b"');
  });

  it('severity containing comma is quoted', () => {
    const csv = alertRowsToCsv([makeAlert({ severity: 'a,b' as 'warn' })]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toContain('"a,b"');
  });
});

// ── 4. String cells with double-quote double the quote char ─────────────────

describe('quoting: double-quote in string', () => {
  it('double-quote is doubled inside quoted cell', () => {
    const csv = positionRowsToCsv([makePosition({ mode: 'a"b' as 'indoor' })]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toContain('"a""b"');
  });
});

// ── 5. String cells with newline are quoted; newline is preserved ────────────

describe('quoting: newline in string', () => {
  it('newline is preserved inside quoted cell', () => {
    const csv = positionRowsToCsv([makePosition({ mode: 'a\nb' as 'indoor' })]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toContain('"a\nb"');
  });
});

// ── 6. Empty input produces header-only file (trailing CRLF) ────────────────

describe('empty input', () => {
  it('vitals: header-only file ends with CRLF', () => {
    const csv = vitalsRowsToCsv([]);
    expect(csv).toBe('recorded_at,hr_bpm,spo2_pct,temp_c\r\n');
  });

  it('positions: header-only file ends with CRLF', () => {
    const csv = positionRowsToCsv([]);
    expect(csv).toBe('recorded_at,mode,x_canvas,y_canvas,lat,lng,confidence\r\n');
  });

  it('alerts: header-only file ends with CRLF', () => {
    const csv = alertRowsToCsv([]);
    expect(csv).toBe('fired_at,severity,rule_type,acknowledged_at,ack_by_caregiver_id\r\n');
  });
});

// ── 7. Line terminator is CRLF ───────────────────────────────────────────────

describe('CRLF line terminator', () => {
  it('all lines end with CRLF', () => {
    const csv = vitalsRowsToCsv([makeVitals(), makeVitals()]);
    // Split on CRLF; last element after final CRLF will be an empty string
    const parts = csv.split('\r\n');
    // header + 2 data rows + trailing empty string = 4 parts
    expect(parts).toHaveLength(4);
    expect(parts[3]).toBe('');
    // Confirm there are no lone LF line endings
    expect(csv).not.toMatch(/(?<!\r)\n/);
  });

  it('no bare LF in multi-row positions export', () => {
    const csv = positionRowsToCsv([makePosition(), makePosition()]);
    expect(csv).not.toMatch(/(?<!\r)\n/);
  });
});
