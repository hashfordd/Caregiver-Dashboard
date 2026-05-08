// Time helpers for the dashboard. All timestamps in the system are stored
// as `timestamptz` and travel as ISO 8601 strings; rendering happens in the
// caregiver's local timezone (CROSS_CUTTING §5).

import { APP_TIMEZONE } from '@alzcare/shared';

// ── AEST / Australia/Sydney helpers (Item 101) ────────────────────────────────
// These replace the inline helpers that previously lived in DateRangePicker.tsx.
// All display-facing timestamp formatting goes through here so the TZ is
// consistent regardless of the presenter machine's local timezone.

/** Returns AEST's UTC offset in milliseconds at the given epoch instant.
 *  The offset varies with DST (AEST +10 / AEDT +11). */
export function appTzOffsetMs(epochMs: number): number {
  const d = new Date(epochMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const hour = lookup.hour === '24' ? '00' : (lookup.hour ?? '00');
  const tzMs = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(hour),
    Number(lookup.minute),
    Number(lookup.second ?? '0'),
  );
  return tzMs - epochMs;
}

/** ISO 8601 UTC string → datetime-local-ready string (YYYY-MM-DDTHH:mm) in AEST.
 *  Used by `<input type="datetime-local">` which has no timezone concept. */
export function toAppTzInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  // en-CA emits dates as YYYY-MM-DD. Hour '24' normalises to '00'.
  const hour = lookup.hour === '24' ? '00' : (lookup.hour ?? '00');
  return `${lookup.year}-${lookup.month}-${lookup.day}T${hour}:${lookup.minute}`;
}

/** datetime-local string (YYYY-MM-DDTHH:mm, wall-clock AEST) → UTC ISO string.
 *  Corrects for DST at the given instant by computing the actual offset. */
export function fromAppTzInput(value: string): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [_, y, mo, d, h, mi] = m;
  const utcGuessMs = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!);
  const offsetMs = appTzOffsetMs(utcGuessMs);
  const trueMs = utcGuessMs - offsetMs;
  const result = new Date(trueMs);
  if (Number.isNaN(result.getTime())) return null;
  return result.toISOString();
}

/** Format an ISO timestamp for display in AEST using Intl. Accepts the same
 *  `opts` as `Intl.DateTimeFormat`; defaults to short date+time. */
export function formatAppTz(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: APP_TIMEZONE,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...opts,
  }).format(d);
}

export function secondsAgo(input: string | number): number {
  const t = typeof input === 'string' ? new Date(input).getTime() : input;
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

export function formatTimestamp(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(
    undefined,
    opts ?? { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  ).format(date);
}

// Compact relative time used by F10's device heartbeat and any future
// "last seen X ago" surface. Returns 'never' when the input is null.
export function relativeTime(input: string | number | null): string {
  if (input == null) return 'never';
  const seconds = secondsAgo(input);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
