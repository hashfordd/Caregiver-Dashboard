import { useEffect, useState } from 'react';

/** Re-renders the consumer every `intervalMs` so age-based UI (stale
 *  pins, "X seconds ago" timers, freshness pills) ticks without each
 *  call site spinning its own interval. Defaults to 5 s.
 *
 *  Lives in lib/ rather than under any one feature so the
 *  outdoor map, the connection-pill freshness check, and any future
 *  freshness-driven widget can pull from a shared timer. */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
