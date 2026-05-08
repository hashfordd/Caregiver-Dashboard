import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { FloorPlanCanvas } from '@/features/floor-plan/FloorPlanCanvas';
import type {
  BeaconSprite,
  FloorPlanCanvasHandle,
  FloorPlanRow,
} from '@/features/floor-plan/types';
import { useUpdateBeaconPosition } from './beaconQueries';
import { isPlaced, type BeaconRow } from './types';

interface BeaconPlacementCanvasProps {
  patientId: string;
  /** The patient's floor plan, or null if none saved yet. The canvas
   *  loads canvas_json once on mount; refreshes happen via the
   *  serialise/deserialise dance F5 already owns — but in placement mode
   *  the floor plan is read-only, so we just take the snapshot at mount. */
  floorPlan: FloorPlanRow | null;
  /** All paired beacons for the patient. Placed ones render on the
   *  canvas; unplaced ones are tracked in memory so a subsequent
   *  armPlacement → click flow can drop them. */
  beacons: BeaconRow[];
}

export interface BeaconPlacementCanvasHandle {
  /** Arm a beacon for placement. The next click on the canvas drops it. */
  arm: (beaconId: string) => void;
}

/** Canvas-side surface of the F6 placement flow. Mirrors `useBeacons`
 *  data into the F5 canvas's beacon overlay layer; persists drag/drop
 *  via useUpdateBeaconPosition. The Beacons sub-tab provides the
 *  list-side affordances (Place/Move buttons). */
export const BeaconPlacementCanvas = forwardRef<
  BeaconPlacementCanvasHandle,
  BeaconPlacementCanvasProps
>(function BeaconPlacementCanvas({ patientId, floorPlan, beacons }, ref) {
  const canvasRef = useRef<FloorPlanCanvasHandle | null>(null);
  const updatePosition = useUpdateBeaconPosition(patientId);

  // Mirror beacons into the canvas overlay every time the list changes.
  // The canvas re-renders the overlay on after:render too, so this only
  // needs to fire on data change, not on viewport change.
  useEffect(() => {
    const sprites: BeaconSprite[] = beacons.map((b) => ({
      id: b.id,
      label: b.label ?? b.mac_address.slice(-5),
      x: b.x_canvas,
      y: b.y_canvas,
    }));
    canvasRef.current?.setBeacons(sprites);
  }, [beacons]);

  const handleBeaconUpdate = useCallback(
    (beaconId: string, x: number, y: number) => {
      updatePosition.mutate({ id: beaconId, x_canvas: x, y_canvas: y });
      // Keep the on-screen overlay armed off after a successful placement.
      canvasRef.current?.armPlacement(null);
    },
    [updatePosition],
  );

  useImperativeHandle(ref, () => ({
    arm: (beaconId: string) => {
      // Only arm beacons that exist in our list — guards against a stale
      // id from a refetch race.
      if (!beacons.some((b) => b.id === beaconId)) return;
      canvasRef.current?.armPlacement(beaconId);
    },
  }));

  return (
    <FloorPlanCanvas
      ref={canvasRef}
      initialJson={floorPlan?.canvas_json ?? null}
      scale={floorPlan?.scale_meters_per_pixel ?? null}
      editing={false}
      initialMode="beacon-placement"
      showDimensions
      onBeaconUpdate={handleBeaconUpdate}
    />
  );
});

/** Convenience: count beacons that have a position set. */
export function placedCount(beacons: BeaconRow[]): number {
  return beacons.filter(isPlaced).length;
}
