import { useEffect, useRef, useState } from 'react';
import type { AlertRow } from '@alzcare/shared';
import { useAllocatedAlerts } from './useAllocatedAlerts';

/** Visually-hidden ARIA live region announcing newly arrived alerts.
 *  Critical → assertive (interrupts), non-critical → polite (queued).
 *  Throttled to one announcement per 5 s for non-critical severities so
 *  a burst of info-level alerts doesn't drown out screen-reader speech;
 *  criticals are never throttled. */
const NON_CRITICAL_THROTTLE_MS = 5000;

export function AlertLiveRegion() {
  const { rows } = useAllocatedAlerts();
  const seenRef = useRef<Set<string>>(new Set());
  const lastNonCriticalAtRef = useRef(0);
  const armedRef = useRef(false);
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  // Same arming pattern as the cue hook — historical alerts shouldn't
  // be announced on mount.
  useEffect(() => {
    if (armedRef.current) return;
    if (rows.length === 0) return;
    for (const row of rows) seenRef.current.add(row.id);
    armedRef.current = true;
  }, [rows]);

  useEffect(() => {
    if (!armedRef.current) return;
    const fresh = rows.filter((r) => !seenRef.current.has(r.id));
    if (fresh.length === 0) return;
    for (const row of fresh) seenRef.current.add(row.id);

    const newest = fresh[0];
    if (!newest) return;
    if (newest.severity === 'critical') {
      setAssertiveMessage(describe(newest));
    } else {
      const now = Date.now();
      if (now - lastNonCriticalAtRef.current < NON_CRITICAL_THROTTLE_MS) return;
      lastNonCriticalAtRef.current = now;
      setPoliteMessage(describe(newest));
    }
  }, [rows]);

  return (
    <div className="sr-only" aria-hidden={false}>
      <div role="status" aria-live="polite" aria-atomic="true">
        {politeMessage}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {assertiveMessage}
      </div>
    </div>
  );
}

function describe(row: AlertRow): string {
  return `${row.severity} alert for patient ${row.patient_id.slice(0, 8)}.`;
}
