import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { FloorPlanCanvas } from '@/features/floor-plan/FloorPlanCanvas';
import type {
  BeaconSprite,
  CalibrationPointSprite,
  FloorPlanCanvasHandle,
  FloorPlanRow,
} from '@/features/floor-plan/types';
import type { BeaconRow } from '@/features/beacons/types';
import type { CalibrationPointRow } from './types';

interface CalibrationCanvasProps {
  floorPlan: FloorPlanRow | null;
  beacons: BeaconRow[];
  points: CalibrationPointRow[];
  /** The pending calibration spot — set by the panel after a click on
   *  the canvas, cleared after Capture succeeds or is cancelled. The
   *  pending sprite renders dashed and the canvas disarms while it's
   *  set so a stray click doesn't replace it silently. */
  pending: { x: number; y: number } | null;
  onCalibrationClick: (x: number, y: number) => void;
}

export interface CalibrationCanvasHandle {
  /** Re-arm capture after the panel clears `pending`. The canvas's
   *  internal armed flag is written via this handle so the parent
   *  doesn't have to recompute it from the prop. */
  arm: () => void;
}

export const CalibrationCanvas = forwardRef<CalibrationCanvasHandle, CalibrationCanvasProps>(
  function CalibrationCanvas({ floorPlan, beacons, points, pending, onCalibrationClick }, ref) {
    const canvasRef = useRef<FloorPlanCanvasHandle | null>(null);

    // Mirror beacons (read-only — calibration mode renders them as
    // visual context but not draggable).
    useEffect(() => {
      const sprites: BeaconSprite[] = beacons
        .filter((b) => b.x_canvas != null && b.y_canvas != null)
        .map((b) => ({
          id: b.id,
          label: b.label ?? b.mac_address.slice(-5),
          x: b.x_canvas,
          y: b.y_canvas,
        }));
      canvasRef.current?.setBeacons(sprites);
    }, [beacons]);

    // Mirror calibration points + pending spot. Index is derived from
    // captured_at ordering — the query already orders ASC.
    useEffect(() => {
      const placed: CalibrationPointSprite[] = points.map((p, i) => ({
        id: p.id,
        index: i + 1,
        x: p.x_canvas,
        y: p.y_canvas,
      }));
      const sprites = pending
        ? [
            ...placed,
            {
              id: '__pending',
              index: placed.length + 1,
              x: pending.x,
              y: pending.y,
              pending: true,
            },
          ]
        : placed;
      canvasRef.current?.setCalibrationPoints(sprites);
    }, [points, pending]);

    // Arm only when there's no pending spot — once the user has clicked,
    // the next action is Capture (or Cancel), not another click.
    useEffect(() => {
      canvasRef.current?.armCalibrationCapture(pending == null);
    }, [pending]);

    const handleCalibrationClick = useCallback(
      (x: number, y: number) => {
        onCalibrationClick(x, y);
      },
      [onCalibrationClick],
    );

    useImperativeHandle(ref, () => ({
      arm: () => canvasRef.current?.armCalibrationCapture(true),
    }));

    return (
      <FloorPlanCanvas
        ref={canvasRef}
        initialJson={floorPlan?.canvas_json ?? null}
        scale={floorPlan?.scale_meters_per_pixel ?? null}
        editing={false}
        initialMode="calibration"
        showDimensions
        onCalibrationClick={handleCalibrationClick}
      />
    );
  },
);
