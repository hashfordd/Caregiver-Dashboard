import { AlertLiveRegion } from './AlertLiveRegion';
import { useCriticalCue } from './useCriticalCue';

/** Mounts the dashboard-level cue subscriptions: critical-alert audio +
 *  desktop notifications, plus a screen-reader live region. Sits in
 *  AppLayout so cues fire across every authenticated route, not just
 *  the patient dashboard. */
export function AlertCueHost() {
  useCriticalCue();
  return <AlertLiveRegion />;
}
