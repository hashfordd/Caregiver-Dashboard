import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useRealtimeHealthStore, selectAnyOffline } from '@/lib/stores/realtimeHealthStore';
import { playCriticalSound } from '@/features/alerts/CriticalCue';

// Re-beep cadence while the connection stays lost — frequent enough to
// pull a caregiver back, not so frequent it becomes noise.
const REPEAT_CUE_MS = 15_000;

/**
 * Loud, unmissable banner shown whenever any realtime channel has
 * exhausted its fast-retry budget (see subscribeWithRetry → "offline").
 * A silently-dead monitoring dashboard is the dangerous failure mode for
 * patient safety, so this is intentionally high-contrast, sticky to the
 * top, announced assertively to screen readers (role="alert"), and
 * accompanied by a repeating audible cue. It clears itself the moment a
 * channel reconnects (the health store flips back to "subscribed").
 */
export function LiveDataLostBanner() {
  const offline = useRealtimeHealthStore(selectAnyOffline);
  const cueTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!offline) return;
    // Immediate cue + repeat while lost. playCriticalSound no-ops until
    // the first user gesture (browser autoplay policy) — the visual
    // banner is the guaranteed channel; sound is the escalation.
    playCriticalSound();
    cueTimerRef.current = setInterval(playCriticalSound, REPEAT_CUE_MS);
    return () => {
      if (cueTimerRef.current != null) clearInterval(cueTimerRef.current);
      cueTimerRef.current = null;
    };
  }, [offline]);

  if (!offline) return null;

  return (
    <div
      role="alert"
      data-testid="live-data-lost-banner"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-center text-sm font-semibold text-destructive-foreground shadow-md"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Live data lost — monitoring is offline. Reconnecting automatically… Alerts may be delayed
        until the connection is restored.
      </span>
    </div>
  );
}
