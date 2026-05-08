import type { AlertHistoryRow, PositionHistoryRow, VitalsHistoryRow } from './types';

// RFC 4180 serialiser. No DOM, no Blob — pure string in / string out.

const VITALS_HEADER = 'recorded_at,hr_bpm,spo2_pct,temp_c';
const POSITION_HEADER = 'recorded_at,mode,x_canvas,y_canvas,lat,lng,confidence';
const ALERT_HEADER = 'fired_at,severity,rule_type,acknowledged_at,ack_by_caregiver_id';

/** Quote a cell value per RFC 4180.
 *  Numerics are returned as-is; null/undefined become empty strings. */
function cell(value: string | number | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  // Quote if the value contains a comma, double-quote, newline, or
  // leading/trailing whitespace — all require quoting per RFC 4180.
  if (/[,"\n\r]/.test(value) || value !== value.trim()) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function rows(lines: string[]): string {
  return lines.join('\r\n') + '\r\n';
}

export function vitalsRowsToCsv(data: VitalsHistoryRow[]): string {
  const lines = [VITALS_HEADER];
  for (const r of data) {
    lines.push([cell(r.recorded_at), cell(r.hr_bpm), cell(r.spo2_pct), cell(r.temp_c)].join(','));
  }
  return rows(lines);
}

export function positionRowsToCsv(data: PositionHistoryRow[]): string {
  const lines = [POSITION_HEADER];
  for (const r of data) {
    lines.push(
      [
        cell(r.recorded_at),
        cell(r.mode),
        cell(r.x_canvas),
        cell(r.y_canvas),
        cell(r.lat),
        cell(r.lng),
        cell(r.confidence),
      ].join(','),
    );
  }
  return rows(lines);
}

export function alertRowsToCsv(data: AlertHistoryRow[]): string {
  const lines = [ALERT_HEADER];
  for (const r of data) {
    lines.push(
      [
        cell(r.fired_at),
        cell(r.severity),
        cell(r.rule_type),
        cell(r.acknowledged_at),
        cell(r.ack_by_caregiver_id),
      ].join(','),
    );
  }
  return rows(lines);
}
