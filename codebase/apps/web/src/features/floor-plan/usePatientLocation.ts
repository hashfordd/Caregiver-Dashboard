import { useMemo } from 'react';
import type { PositionEstimateRow } from '@/lib/usePatientStream';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { useRoomConnectors, useRooms } from './roomQueries';
import {
  computeLocationContext,
  extractFurniture,
  pointInPolygon,
  type LocationContext,
} from './locationContext';

export interface PatientLocation {
  /** Human "where / doing what" badge, or null when there's no usable indoor
   *  fix (outdoor mode, no estimate, or no floor plan placed yet). */
  context: LocationContext | null;
  /** Containing room name, independent of the furniture/door context, or null. */
  roomName: string | null;
}

/** Resolve a patient's indoor position into a location context from the placed
 *  floor-plan geometry (rooms, furniture, doors/windows). Lifted out of
 *  LivePositionView so the live map and the Current Activity card derive the
 *  same "In bed" / "Near the door" / room phrasing from one place — and so both
 *  can be fed the motion-gated position rather than the raw jittery estimate.
 *
 *  Reuses the existing floor-plan / rooms / connectors query caches, so it adds
 *  no network calls beyond what the patient page already holds. */
export function usePatientLocation(
  patientId: string,
  estimate: PositionEstimateRow | null | undefined,
): PatientLocation {
  const planQuery = useFloorPlan(patientId);
  const roomsQuery = useRooms(planQuery.data?.id);
  const connectorsQuery = useRoomConnectors(planQuery.data?.id);

  const furniture = useMemo(
    () => extractFurniture(planQuery.data?.canvas_json ?? null),
    [planQuery.data?.canvas_json],
  );

  // Primitive deps (not a fresh {x,y} object each render) so the memo is stable.
  const x = estimate?.mode === 'indoor' ? estimate.x_canvas : null;
  const y = estimate?.mode === 'indoor' ? estimate.y_canvas : null;
  const scale = planQuery.data?.scale_meters_per_pixel ?? null;

  return useMemo(() => {
    if (x == null || y == null) return { context: null, roomName: null };
    const pos = { x, y };
    const rooms = roomsQuery.data ?? [];
    const context = computeLocationContext(
      pos,
      rooms,
      connectorsQuery.data ?? [],
      furniture,
      scale,
    );
    const roomName = rooms.find((r) => pointInPolygon(pos, r.polygon_canvas))?.name ?? null;
    return { context, roomName };
  }, [x, y, roomsQuery.data, connectorsQuery.data, furniture, scale]);
}
