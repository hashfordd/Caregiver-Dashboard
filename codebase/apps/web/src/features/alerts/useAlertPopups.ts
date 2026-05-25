import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertRow } from '@alzcare/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAllocatedAlerts } from './useAllocatedAlerts';

/** Severities prominent enough to interrupt with a modal. `info` only
 *  pulses the bell + bumps the count. */
const POPUP_SEVERITIES = new Set<AlertRow['severity']>(['warn', 'critical']);

export interface AlertPopups {
  /** The alert currently shown in the dialog, or null when the queue is empty. */
  active: AlertRow | null;
  /** How many further alerts are queued behind the active one. */
  remaining: number;
  /** Remove an alert from the queue (acknowledged or dismissed). */
  dismiss: (id: string) => void;
}

/** Watches the shared allocated-alerts cache and queues newly-arrived
 *  unacked warn/critical alerts for the pop-up dialog. Mirrors
 *  useCriticalCue's arming: it seeds a "seen" set the moment the initial
 *  fetch resolves so historical alerts don't pop on load — only arrivals
 *  beyond that point queue. Alerts acked in this tab or another drop out
 *  of the queue automatically. */
export function useAlertPopups(): AlertPopups {
  const { user } = useAuth();
  const { rows, isSuccess } = useAllocatedAlerts();
  const seenRef = useRef<Set<string>>(new Set());
  const armedRef = useRef(false);
  const [queue, setQueue] = useState<AlertRow[]>([]);

  // Reset on caregiver change so a previous session's state doesn't leak
  // across an in-SPA logout/login.
  useEffect(() => {
    armedRef.current = false;
    seenRef.current = new Set();
    setQueue([]);
  }, [user?.id]);

  // Seed the seen-set once the initial fetch resolves — everything present
  // at arm time counts as "already seen".
  useEffect(() => {
    if (armedRef.current || !isSuccess) return;
    for (const row of rows) seenRef.current.add(row.id);
    armedRef.current = true;
  }, [isSuccess, rows]);

  // Enqueue fresh warn/critical unacked alerts.
  useEffect(() => {
    if (!armedRef.current) return;
    const fresh = rows.filter(
      (r) =>
        POPUP_SEVERITIES.has(r.severity) && r.acknowledged_at == null && !seenRef.current.has(r.id),
    );
    if (fresh.length === 0) return;
    for (const row of fresh) seenRef.current.add(row.id);
    setQueue((prev) => {
      const ids = new Set(prev.map((r) => r.id));
      const additions = fresh.filter((r) => !ids.has(r.id));
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, [rows]);

  // Drop any queued alert that's since been acknowledged (here or elsewhere).
  useEffect(() => {
    const acked = new Set(rows.filter((r) => r.acknowledged_at != null).map((r) => r.id));
    if (acked.size === 0) return;
    setQueue((prev) => {
      const next = prev.filter((r) => !acked.has(r.id));
      return next.length === prev.length ? prev : next;
    });
  }, [rows]);

  const dismiss = useCallback((id: string) => {
    setQueue((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { active: queue[0] ?? null, remaining: Math.max(0, queue.length - 1), dismiss };
}
