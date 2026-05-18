import { Marker } from 'react-map-gl/mapbox';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

interface PatientPinProps {
  estimate: PositionEstimateRow;
  /** Display name for the label chip below the dot. Pass the patient's
   *  first or full name; falsy values hide the chip. */
  name?: string | null;
  /** Now-ish in ms; passed in so the component can evaluate "is this fix
   *  stale" against an injectable clock for tests. Defaults to Date.now()
   *  via the `useNow` hook in the parent. */
  nowMs: number;
}

/** Latest GPS fix marker. Opacity tracks confidence (clamped to 0.3 floor
 *  so the dot never disappears); a yellow stale ring shows when the fix
 *  is older than 30 s. Optional name chip sits below the dot so the
 *  caregiver can identify the pin at a glance when more than one patient
 *  view is open. */
const STALE_THRESHOLD_MS = 30_000;

export function PatientPin({ estimate, name, nowMs }: PatientPinProps) {
  if (estimate.lat == null || estimate.lng == null) return null;
  const ageMs = Math.max(0, nowMs - new Date(estimate.recorded_at).getTime());
  const stale = ageMs > STALE_THRESHOLD_MS;
  const confidence = estimate.confidence ?? 0;
  const opacity = Math.max(0.3, confidence);

  return (
    <Marker latitude={estimate.lat} longitude={estimate.lng} anchor="center">
      <div
        title={`Last fix ${Math.round(ageMs / 1000)} s ago · confidence ${Math.round(confidence * 100)}%`}
        className="flex flex-col items-center"
      >
        <div className="relative h-4 w-4">
          {stale && (
            <span className="absolute -inset-2 rounded-full bg-amber-400/30 ring-2 ring-amber-500/60" />
          )}
          <span
            className="absolute inset-0 rounded-full bg-primary shadow-[0_0_0_3px_rgba(255,255,255,0.85)]"
            style={{ opacity }}
          />
        </div>
        {name && (
          <span className="mt-1 max-w-[12rem] truncate whitespace-nowrap rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
            {name}
          </span>
        )}
      </div>
    </Marker>
  );
}
