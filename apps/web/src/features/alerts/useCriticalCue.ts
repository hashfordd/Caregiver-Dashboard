import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AlertRow } from '@alzcare/shared';
import {
  playCriticalSound,
  requestNotificationPermission,
  showCriticalNotification,
} from './CriticalCue';
import { useAllocatedAlerts } from './useAllocatedAlerts';

/** Mounted once at the dashboard shell so cues fire for any allocated
 *  patient regardless of which page the caregiver is on. Watches the
 *  shared allocated-alerts cache, dispatches Web Audio + Notification
 *  cues only on critical inserts that haven't been seen before. */
export function useCriticalCue(): void {
  const { rows } = useAllocatedAlerts();
  const navigate = useNavigate();
  const seenRef = useRef<Set<string>>(new Set());
  const armedRef = useRef(false);

  // Seed the seen-set on first run so historical critical alerts that
  // were already in the DB don't trigger a cue when the dashboard
  // mounts. Only NEW criticals (arrived after first render) fire.
  useEffect(() => {
    if (armedRef.current) return;
    if (rows.length === 0) return;
    for (const row of rows) seenRef.current.add(row.id);
    armedRef.current = true;
  }, [rows]);

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
        body: `Patient ${row.patient_id.slice(0, 8)} — open the dashboard to acknowledge.`,
        tag: row.id,
        onClick: () => navigate(`/patients/${row.patient_id}?tab=alerts`),
      });
    }
  }, [rows, navigate]);
}
