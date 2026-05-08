// F12 critical-alert cues. Web Audio API for an in-tab tone +
// Notification API for a desktop banner when the tab is hidden.
//
// Permission UX: prompted exactly once per session, on the first
// critical that arrives — never on app load. The session-storage flag
// memoises the prompt so a denied permission isn't asked again until
// the next browser tab opens.
//
// AudioContext autoplay policy: browsers require a prior user gesture.
// We lazy-create the context on the first interaction (any click on
// document); if the very first critical arrives before any interaction
// has happened, the tone silently no-ops and the visual + Notification
// + live-region cues still fire.

const PERMISSION_SESSION_KEY = 'alzcare:notification_permission_prompted';

let audioContext: AudioContext | null = null;
let firstGestureBound = false;

function ensureFirstGestureListener(): void {
  if (firstGestureBound || typeof window === 'undefined') return;
  firstGestureBound = true;
  const onFirst = () => {
    if (audioContext == null) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        try {
          audioContext = new Ctx();
        } catch {
          audioContext = null;
        }
      }
    }
    window.removeEventListener('pointerdown', onFirst);
    window.removeEventListener('keydown', onFirst);
  };
  window.addEventListener('pointerdown', onFirst);
  window.addEventListener('keydown', onFirst);
}

ensureFirstGestureListener();

/** Plays a short tone (~880 Hz, 250 ms with envelope). Reuses one
 *  AudioContext across plays. No-op if no user gesture has happened
 *  yet during the session. */
export function playCriticalSound(): void {
  if (typeof window === 'undefined' || audioContext == null) return;
  try {
    const ctx = audioContext;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.27);
  } catch {
    // swallow — visual + notification cues still fire
  }
}

/** Wraps Notification.requestPermission with a single-prompt-per-session
 *  guard. Returns the resolved permission. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    if (sessionStorage.getItem(PERMISSION_SESSION_KEY) === '1') {
      return Notification.permission;
    }
    sessionStorage.setItem(PERMISSION_SESSION_KEY, '1');
  } catch {
    // sessionStorage may be blocked; not fatal.
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

interface NotificationInput {
  title: string;
  body: string;
  /** Used as the Notification tag so multiple criticals collapse rather
   *  than stacking. */
  tag?: string;
  onClick?: () => void;
}

/** Shows a desktop notification only when the tab is hidden and the
 *  user has granted permission. Returns true if a notification was
 *  fired. */
export function showCriticalNotification(input: NotificationInput): boolean {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (!document.hidden) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(input.title, { body: input.body, tag: input.tag });
    if (input.onClick) {
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          // ignore
        }
        input.onClick?.();
      };
    }
    return true;
  } catch {
    return false;
  }
}
