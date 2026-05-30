import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';
import { useNow } from '@/lib/useNow';
import type { ActivityState } from '@/lib/activity';

const STALE_MS = 30 * 1000;

export interface ActivitySnapshot {
  /** Current motion class, or null until the first accel reading arrives. */
  state: ActivityState | null;
  /** Epoch ms the patient entered `state` (for "time in this state"). */
  since: number | null;
  magnitudeG: number | null;
  gyroDps: number | null;
  lastReceivedAt: number | null;
  /** No reading in the last 30 s. */
  stale: boolean;
}

/** Read the patient's live activity from the shared sensor store. Thin wrapper
 *  so the Movement card, the Current Activity card, and the position
 *  motion-gate all consume one classification and one staleness rule. */
export function useActivity(patientId: string): ActivitySnapshot {
  const movement = useLiveSensorStore((s) => s.movement[patientId]);
  const now = useNow(1000);

  const lastReceivedAt = movement?.lastReceivedAt ?? null;
  const stale = lastReceivedAt != null && now - lastReceivedAt > STALE_MS;

  return {
    state: movement?.activityState ?? null,
    since: movement?.activitySince ?? null,
    magnitudeG: movement?.latest?.magnitudeG ?? null,
    gyroDps: movement?.latest?.gyroDps ?? null,
    lastReceivedAt,
    stale,
  };
}
