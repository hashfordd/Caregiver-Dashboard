import { useEffect, useRef, useState } from 'react';
import type { AlertRow } from '@alzcare/shared';
import { usePatientsLookup } from '@/features/patients/usePatientsLookup';
import { useAllocatedAlerts } from './useAllocatedAlerts';

/** Visually-hidden ARIA live region announcing newly arrived alerts.
 *  Critical → assertive (interrupts), non-critical → polite (queued).
 *  Throttled to one announcement per 5 s for non-critical severities so
 *  a burst of info-level alerts doesn't drown out screen-reader speech;
 *  criticals are never throttled.
 *
 *  Phase E updates: arm on query.isSuccess (item 43) so initial-fetch
 *  criticals don't land in the seen-set silently; hydrate the patient
 *  name via lookup (item 42). */
const NON_CRITICAL_THROTTLE_MS = 5000;

export function AlertLiveRegion() {
  const { rows, isSuccess } = useAllocatedAlerts();
  const lookup = usePatientsLookup();
  const seenRef = useRef<Set<string>>(new Set());
  const lastNonCriticalAtRef = useRef(0);
  const armedRef = useRef(false);
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  useEffect(() => {
    if (armedRef.current) return;
    if (!isSuccess) return;
    for (const row of rows) seenRef.current.add(row.id);
    armedRef.current = true;
  }, [isSuccess, rows]);

  useEffect(() => {
    if (!armedRef.current) return;
    const fresh = rows.filter((r) => !seenRef.current.has(r.id));
    if (fresh.length === 0) return;
    for (const row of fresh) seenRef.current.add(row.id);

    const newest = fresh[0];
    if (!newest) return;
    if (newest.severity === 'critical') {
      setAssertiveMessage(describe(newest, lookup.resolve(newest.patient_id)));
    } else {
      const now = Date.now();
      if (now - lastNonCriticalAtRef.current < NON_CRITICAL_THROTTLE_MS) return;
      lastNonCriticalAtRef.current = now;
      setPoliteMessage(describe(newest, lookup.resolve(newest.patient_id)));
    }
  }, [rows, lookup]);

  return (
    <div className="sr-only">
      <div role="status" aria-live="polite" aria-atomic="true">
        {politeMessage}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {assertiveMessage}
      </div>
    </div>
  );
}

function describe(row: AlertRow, patientName: string): string {
  return `${row.severity} alert for ${patientName}.`;
}
