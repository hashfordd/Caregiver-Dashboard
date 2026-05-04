// Time helpers for the dashboard. All timestamps in the system are stored
// as `timestamptz` and travel as ISO 8601 strings; rendering happens in the
// caregiver's local timezone (CROSS_CUTTING §5).

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
