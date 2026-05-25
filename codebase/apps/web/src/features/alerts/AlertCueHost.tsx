import { AlertLiveRegion } from './AlertLiveRegion';
import { AlertPopupHost } from './AlertPopupHost';
import { useCriticalCue } from './useCriticalCue';

/** Mounts the dashboard-level cue subscriptions: critical-alert audio +
 *  desktop notifications, a screen-reader live region, and the in-app
 *  pop-up dialog for new warn/critical alerts. Sits in AppLayout so cues
 *  fire across every authenticated route, not just the patient dashboard. */
export function AlertCueHost() {
  useCriticalCue();
  return (
    <>
      <AlertLiveRegion />
      <AlertPopupHost />
    </>
  );
}
