// Shared patient-activity classification. Derives a coarse motion state
// (resting / light / active) from the wearable's accelerometer magnitude
// deviation from 1 g (rest) plus gyro rotation rate. Tuned for the QMI8658
// at rest (~1 g, a few deg/s of noise); a single spike is left to the fall
// rule — this reflects sustained motion level.
//
// Pure: no React, no store. Consumed by the live Movement card, the Current
// Activity card, and the indoor position motion-gate so all three agree on
// one definition of "is the patient moving?".

export type ActivityState = 'resting' | 'light' | 'active';

/** |magnitude − 1 g| below this ⇒ essentially still. */
export const REST_DEV_G = 0.08;
export const LIGHT_DEV_G = 0.3;
export const REST_GYRO_DPS = 20;
export const LIGHT_GYRO_DPS = 90;

/** Accelerometer magnitude (g) → deviation from the 1 g rest baseline. */
export function magnitudeDeviationG(magnitudeG: number): number {
  return Math.abs(magnitudeG - 1);
}

/** Classify sustained motion level from accel deviation + gyro rate. */
export function classifyActivity(devG: number, gyroDps: number): ActivityState {
  if (devG < REST_DEV_G && gyroDps < REST_GYRO_DPS) return 'resting';
  if (devG < LIGHT_DEV_G && gyroDps < LIGHT_GYRO_DPS) return 'light';
  return 'active';
}

export const ACTIVITY_LABEL: Record<ActivityState, string> = {
  resting: 'Resting',
  light: 'Light activity',
  active: 'Active',
};

/** Tailwind text colour for the activity headline. `stale` overrides to the
 *  destructive tone so a frozen reading reads as a problem, not a state. */
export function activityColor(state: ActivityState, stale: boolean): string {
  if (stale) return 'text-destructive';
  if (state === 'resting') return 'text-muted-foreground';
  if (state === 'light') return 'text-foreground';
  return 'text-amber-500 dark:text-amber-400';
}

/** Roll the "in this state since" timestamp forward: keep the previous start
 *  while the class is unchanged, reset to the new reading's time when it flips.
 *  The single source of truth for "time in this state". */
export function nextActivitySince(
  prevState: ActivityState | null,
  prevSince: number | null,
  nextState: ActivityState,
  recordedAt: number,
): number {
  if (prevState === nextState && prevSince != null) return prevSince;
  return recordedAt;
}
