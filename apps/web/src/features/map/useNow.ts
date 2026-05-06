import { useEffect, useState } from 'react';

/** Re-renders the consumer every `intervalMs` so age-based UI (stale
 *  pins, "X seconds ago" timers) ticks without each call site spinning
 *  its own interval. Defaults to 5 s. */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
