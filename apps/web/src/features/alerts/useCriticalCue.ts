import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePatientsLookup } from '@/features/patients/usePatientsLookup';
import {
  playCriticalSound,
  requestNotificationPermission,
  showCriticalNotification,
} from './CriticalCue';
import { useAllocatedAlerts } from './useAllocatedAlerts';

/** Mounted once at the dashboard shell so cues fire for any allocated
 *  patient regardless of which page the caregiver is on. Watches the
 *  shared allocated-alerts cache, dispatches Web Audio + Notification
 *  cues only on critical inserts that haven't been seen before.
 *
 *  Phase E updates:
 *    - item 43: arm on `query.isSuccess` rather than first non-empty
 *      rows. The old behaviour swallowed criticals that landed inside
 *      the initial fetch's response — they were added to seenRef as
 *      part of the seed and never fired the cue.
 *    - item 42: hydrates the patient name via usePatientsLookup so the
 *      desktop notification body and console log say "Margaret
 *      Holloway" instead of "Patient 11111111". */
export function useCriticalCue(): void {
  const { user } = useAuth();
  const { rows, isSuccess } = useAllocatedAlerts();
  const navigate = useNavigate();
  const lookup = usePatientsLookup();
  const seenRef = useRef<Set<string>>(new Set());
  const armedRef = useRef(false);

  // Item 157: reset on caregiver change so the previous user's arming
  // state doesn't carry over after an in-SPA logout/login.
  useEffect(() => {
    armedRef.current = false;
    seenRef.current = new Set();
  }, [user?.id]);

  // Seed the seen-set the moment the initial fetch resolves so historical
  // alerts don't trigger a cue. Arming on isSuccess (rather than rows
  // becoming non-empty) means the first batch of alerts — including
  // criticals — gets recorded as "already seen" and only NEW arrivals
  // beyond that point fire.
  useEffect(() => {
    if (armedRef.current) return;
    if (!isSuccess) return;
    for (const row of rows) seenRef.current.add(row.id);
    armedRef.current = true;
  }, [isSuccess, rows]);

  useEffect(() => {
    if (!armedRef.current) return;
    const fresh = rows.filter(
      (r) => r.severity === 'critical' && r.acknowledged_at == null && !seenRef.current.has(r.id),
    );
    if (fresh.length === 0) return;
    for (const row of fresh) seenRef.current.add(row.id);
    void requestNotificationPermission();
    playCriticalSound();
    for (const row of fresh) {
      showCriticalNotification({
        title: 'Critical alert',
        body: `${lookup.resolve(row.patient_id)} — open the dashboard to acknowledge.`,
        tag: row.id,
        onClick: () => navigate(`/patients/${row.patient_id}?tab=alerts`),
      });
    }
  }, [rows, navigate, lookup]);
}
