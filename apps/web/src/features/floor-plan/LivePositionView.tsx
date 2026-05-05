import { useEffect, useRef } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useBeacons } from '@/features/beacons/beaconQueries';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { ModeIndicator } from './ModeIndicator';
import { usePositionMarker } from './usePositionMarker';
import type { BeaconSprite, FloorPlanCanvasHandle, PatientMarkerSprite } from './types';

interface LivePositionViewProps {
  patientId: string;
}

/** Read-only floor-plan view with the live patient marker on top.
 *  Mounted in the Live tab so caregivers see "where the patient is
 *  right now" alongside vitals. The floor plan loads via the same
 *  query as Place, the beacons via the same query as Beacons —
 *  reusing existing caches so this view is essentially free of new
 *  network calls beyond the realtime stream that's already open.
 *
 *  Marker rendering: the canvas owns a single marker DOM node we
 *  reposition imperatively as new estimates arrive. Outdoor estimates
 *  hide the marker (no canvas position to show). */
export function LivePositionView({ patientId }: LivePositionViewProps) {
  const planQuery = useFloorPlan(patientId);
  const beaconsQuery = useBeacons(patientId);
  const estimate = usePositionMarker();
  const canvasRef = useRef<FloorPlanCanvasHandle | null>(null);

  // Mirror placed beacons into the canvas as visual context. The Live
  // view doesn't care about beacon-placement mode but the overlay
  // helper is the same as F6 — reuse it.
  useEffect(() => {
    const beacons = beaconsQuery.data ?? [];
    const sprites: BeaconSprite[] = beacons
      .filter((b) => b.x_canvas != null && b.y_canvas != null)
      .map((b) => ({
        id: b.id,
        label: b.label ?? b.mac_address.slice(-5),
        x: b.x_canvas,
        y: b.y_canvas,
      }));
    canvasRef.current?.setBeacons(sprites);
  }, [beaconsQuery.data]);

  // Push the latest estimate into the canvas marker. Outdoor mode and
  // null canvas coords both clear the marker (no useful indoor position
  // to render).
  useEffect(() => {
    if (
      estimate == null ||
      estimate.mode !== 'indoor' ||
      estimate.x_canvas == null ||
      estimate.y_canvas == null
    ) {
      canvasRef.current?.setPatientMarker(null);
      return;
    }
    const sprite: PatientMarkerSprite = {
      x: estimate.x_canvas,
      y: estimate.y_canvas,
      confidence: estimate.confidence ?? 0,
      recorded_at: estimate.recorded_at,
    };
    canvasRef.current?.setPatientMarker(sprite);
  }, [estimate]);

  if (planQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-[min(60vh,720px)] min-h-[480px] w-full" />
      </div>
    );
  }

  const plan = planQuery.data ?? null;
  if (plan == null) {
    return (
      <EmptyState
        icon={<LayoutGrid className="h-10 w-10" />}
        title="No floor plan yet"
        description="Open the Place tab to set up the patient's floor plan. Once it's saved, the live position marker will appear here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Live position</h3>
          <ModeIndicator estimate={estimate} />
        </div>
        <div className="h-[min(60vh,720px)] min-h-[480px] w-full overflow-hidden rounded-lg border border-border bg-card">
          {/* `initialMode="calibration"` is the F6/F7 read-only mode that
              renders placed beacons as visual context but keeps everything
              non-interactive (no drag, no click-to-add, just panning + zoom).
              Marker rendering is independent of mode. */}
          <FloorPlanCanvas
            ref={canvasRef}
            initialJson={plan.canvas_json ?? null}
            scale={plan.scale_meters_per_pixel ?? null}
            editing={false}
            initialMode="calibration"
            showDimensions
          />
        </div>
        {estimate != null && estimate.mode === 'indoor' && (
          <p className="text-xs text-muted-foreground">
            Last update {new Date(estimate.recorded_at).toLocaleTimeString()} · confidence{' '}
            {((estimate.confidence ?? 0) * 100).toFixed(0)}%
          </p>
        )}
        {estimate != null && estimate.mode === 'outdoor' && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Patient is outdoors — switch to map view (Phase 4) to see the GPS position.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
