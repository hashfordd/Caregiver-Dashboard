import { useEffect, useRef, useState } from 'react';
import type { AlertRow } from '@alzcare/shared';
import { useAuth } from '@/features/auth/AuthProvider';
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
  const { user } = useAuth();
  const { rows, isSuccess } = useAllocatedAlerts();
  const lookup = usePatientsLookup();
  const seenRef = useRef<Set<string>>(new Set());
  const lastNonCriticalAtRef = useRef(0);
  const armedRef = useRef(false);
  const pendingNonCriticalRef = useRef<AlertRow | null>(null);
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  // Item 157: reset the seen-set + arm flag when the signed-in caregiver
  // changes (in-SPA logout/login). Without this the new caregiver would
  // inherit the previous user's arming state and silently mis-seed
  // against rows that aren't theirs.
  useEffect(() => {
    armedRef.current = false;
    seenRef.current = new Set();
    lastNonCriticalAtRef.current = 0;
    pendingNonCriticalRef.current = null;
  }, [user?.id]);

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

    const criticals = fresh.filter((r) => r.severity === 'critical');
    const nonCriticals = fresh.filter((r) => r.severity !== 'critical');

    // Criticals are never throttled — announce + mark seen immediately.
    for (const row of criticals) seenRef.current.add(row.id);
    if (criticals[0]) {
      setAssertiveMessage(describe(criticals[0], lookup.resolve(criticals[0].patient_id)));
    }

    // Item 121: non-critical announcements are RATE-LIMITED, not dropped.
    // Earlier code marked rows seen before the throttle gate, so a burst
    // of warns within 5s would be silently swallowed; queue the most
    // recent and emit when the gate opens. Mark seen only after announce.
    if (nonCriticals[0]) {
      pendingNonCriticalRef.current = nonCriticals[nonCriticals.length - 1] ?? null;
    }
  }, [rows, lookup]);

  // Drains the pending non-critical queue as soon as the throttle gate
  // opens. Re-runs whenever rows change (the announcement effect just
  // committed) or on a one-shot timer if the gate is in the future.
  useEffect(() => {
    const pending = pendingNonCriticalRef.current;
    if (!pending) return;
    const now = Date.now();
    const gapMs = now - lastNonCriticalAtRef.current;
    if (gapMs >= NON_CRITICAL_THROTTLE_MS) {
      lastNonCriticalAtRef.current = now;
      setPoliteMessage(describe(pending, lookup.resolve(pending.patient_id)));
      seenRef.current.add(pending.id);
      pendingNonCriticalRef.current = null;
      return;
    }
    const wait = NON_CRITICAL_THROTTLE_MS - gapMs;
    const handle = setTimeout(() => {
      const queued = pendingNonCriticalRef.current;
      if (!queued) return;
      lastNonCriticalAtRef.current = Date.now();
      setPoliteMessage(describe(queued, lookup.resolve(queued.patient_id)));
      seenRef.current.add(queued.id);
      pendingNonCriticalRef.current = null;
    }, wait);
    return () => clearTimeout(handle);
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
