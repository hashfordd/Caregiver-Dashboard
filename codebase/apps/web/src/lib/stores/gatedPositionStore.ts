import { create } from 'zustand';
import type { PositionEstimateRow } from '@/lib/usePatientStream';
import type { ActivityState } from '@/lib/activity';
import {
  initGateState,
  stepGate,
  type GateInput,
  type GateState,
} from '@/features/floor-plan/motionGate';

/** A position estimate after the motion-gate, shaped exactly like the raw row
 *  so consumers (canvas marker, location context) need no changes — only
 *  x_canvas/y_canvas are overridden, plus a `held` flag for "frozen at rest". */
export type GatedEstimate = PositionEstimateRow & { held: boolean };

interface PatientGate {
  gate: GateState;
  output: GatedEstimate | null;
}

interface GatedPositionState {
  byPatient: Record<string, PatientGate>;
  /** Advance a patient's gate with the latest raw estimate + activity class.
   *  Idempotent (delegates to stepGate): repeat calls with the same estimate
   *  under the same activity are no-ops, so multiple consumers and the
   *  independent IMU/position tick rates are safe. */
  pushRaw: (
    patientId: string,
    raw: PositionEstimateRow | null | undefined,
    activity: ActivityState | null,
    scaleMetersPerPixel: number | null,
  ) => void;
}

function toInput(raw: PositionEstimateRow | null | undefined): GateInput | null {
  if (raw == null || raw.mode !== 'indoor' || raw.x_canvas == null || raw.y_canvas == null) {
    return null;
  }
  return {
    x: raw.x_canvas,
    y: raw.y_canvas,
    recorded_at: raw.recorded_at,
    confidence: raw.confidence ?? 0,
  };
}

export const useGatedPositionStore = create<GatedPositionState>((set, get) => ({
  byPatient: {},
  pushRaw: (patientId, raw, activity, scaleMetersPerPixel) => {
    const prev = get().byPatient[patientId] ?? { gate: initGateState(), output: null };
    const input = toInput(raw);
    const { state, display } = stepGate(prev.gate, input, activity, scaleMetersPerPixel);

    // Outdoor / no indoor fix: pass the raw row through untouched (the live view
    // hides the indoor marker for outdoor anyway) so mode-routing still works.
    const output: GatedEstimate | null =
      display == null
        ? raw == null
          ? null
          : { ...raw, held: false }
        : {
            ...(raw as PositionEstimateRow),
            x_canvas: display.x,
            y_canvas: display.y,
            held: display.held,
          };

    // Skip the write when nothing changed — stepGate returns the same state
    // reference on the idempotent path, which would otherwise loop the effect.
    if (state === prev.gate && sameOutput(prev.output, output)) return;

    set((s) => ({ byPatient: { ...s.byPatient, [patientId]: { gate: state, output } } }));
  },
}));

function sameOutput(a: GatedEstimate | null, b: GatedEstimate | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return (
    a.x_canvas === b.x_canvas &&
    a.y_canvas === b.y_canvas &&
    a.held === b.held &&
    a.recorded_at === b.recorded_at &&
    a.mode === b.mode
  );
}
