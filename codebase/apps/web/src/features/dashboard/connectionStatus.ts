import type { ConnectionStatus } from './types';

// Online while the last position is fresh enough that the wearable
// could still plausibly be transmitting. Stale once the gap exceeds
// the realtime channel's keepalive window. Offline when nothing has
// landed for long enough that the wearable is almost certainly off
// or out of range.
//
// The bridge ingests at ~1 Hz under normal conditions; 30 s gives us
// ~30 missed reports before the dot drops to amber.
export const ONLINE_MAX_AGE_MS = 30_000;
export const STALE_MAX_AGE_MS = 5 * 60_000;

export function deriveConnectionStatus(
  lastPositionAt: string | null,
  now: number = Date.now(),
): ConnectionStatus {
  if (!lastPositionAt) return 'offline';
  const ageMs = now - new Date(lastPositionAt).getTime();
  if (ageMs <= ONLINE_MAX_AGE_MS) return 'online';
  if (ageMs <= STALE_MAX_AGE_MS) return 'stale';
  return 'offline';
}

export function formatRelativeAge(lastPositionAt: string | null, now: number = Date.now()): string {
  if (!lastPositionAt) return 'never';
  const ageMs = now - new Date(lastPositionAt).getTime();
  if (ageMs < 5_000) return 'just now';
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
