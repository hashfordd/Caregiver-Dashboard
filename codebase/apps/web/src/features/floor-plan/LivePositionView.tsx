import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useBeacons } from '@/features/beacons/beaconQueries';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { useNow } from '@/lib/useNow';
import { BeaconDiagnosticsPanel } from './BeaconDiagnosticsPanel';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { ModeIndicator } from './ModeIndicator';
import { useRoomConnectors, useRooms } from './roomQueries';
import { CONNECTOR_KIND_LABEL } from './roomTypes';
import { computeLocationContext, extractFurniture } from './locationContext';
import { cn } from '@/lib/utils';
import { usePositionMarker } from './usePositionMarker';
import type {
  BeaconSprite,
  FloorPlanCanvasHandle,
  PatientMarkerSprite,
  RoomConnectorSprite,
  RoomSprite,
} from './types';

// Item 94: indoor patient marker stale ring threshold. Mirrors the
// outdoor PatientPin's 30 s amber ring (apps/web/src/features/map/
// PatientPin.tsx) so caregivers can tell live from stale at a glance.
const STALE_THRESHOLD_MS = 30_000;

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
  const roomsQuery = useRooms(planQuery.data?.id);
  const connectorsQuery = useRoomConnectors(planQuery.data?.id);
  const estimate = usePositionMarker();
  const discovered = useDiscoveredBeaconsStore((s) => s.cards[patientId]);
  const canvasRef = useRef<FloorPlanCanvasHandle | null>(null);
  // Item 94: 5 s tick drives the stale ring transition. Cheaper than
  // a 1 Hz timer; the patient marker doesn't need sub-5 s freshness.
  const nowMs = useNow(5_000);
  // Diagnostics panel is off by default — caregivers don't need the
  // per-beacon RSSI/distance numbers. Engineers/installers can flip it
  // on to debug placement and calibration.
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Mirror placed beacons into the canvas as visual context. The Live
  // view doesn't care about beacon-placement mode but the overlay
  // helper is the same as F6 — reuse it.
  useEffect(() => {
    const beacons = beaconsQuery.data ?? [];
    const cards = discovered ?? {};
    const sprites: BeaconSprite[] = beacons
      .filter((b) => b.x_canvas != null && b.y_canvas != null)
      .map((b) => {
        const card = cards[b.mac_address];
        return {
          id: b.id,
          label: b.label ?? b.mac_address.slice(-5),
          x: b.x_canvas,
          y: b.y_canvas,
          rssi: card?.lastRssi ?? null,
          battery: card?.lastBattery ?? null,
        };
      });
    canvasRef.current?.setBeacons(sprites);
  }, [beaconsQuery.data, discovered]);

  // Phase B: push rooms + connectors into the canvas overlay. Both
  // surface on Live so caregivers see "the patient is in the bedroom"
  // without flipping to Place. Polygon vertices are stored as [x, y]
  // tuples; connectors as start/end coords.
  useEffect(() => {
    const rooms = roomsQuery.data ?? [];
    const sprites: RoomSprite[] = rooms.map((r) => ({
      id: r.id,
      name: r.name,
      roomType: r.room_type,
      polygon: r.polygon_canvas,
    }));
    canvasRef.current?.setRooms(sprites);
  }, [roomsQuery.data]);
  useEffect(() => {
    const connectors = connectorsQuery.data ?? [];
    const sprites: RoomConnectorSprite[] = connectors.map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label ?? CONNECTOR_KIND_LABEL[c.kind],
      start: { x: c.start_x, y: c.start_y },
      end: { x: c.end_x, y: c.end_y },
    }));
    canvasRef.current?.setRoomConnectors(sprites);
  }, [connectorsQuery.data]);

  // Push the latest estimate into the canvas marker. Outdoor mode and
  // null canvas coords both clear the marker (no useful indoor position
  // to render). Item 94: pass an isStale flag so the canvas can render
  // an amber ring around the dot when the latest estimate is older than
  // 30 s — matching the outdoor PatientPin.
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
    const ageMs = nowMs - new Date(estimate.recorded_at).getTime();
    const sprite: PatientMarkerSprite = {
      x: estimate.x_canvas,
      y: estimate.y_canvas,
      confidence: estimate.confidence ?? 0,
      recorded_at: estimate.recorded_at,
      isStale: ageMs > STALE_THRESHOLD_MS,
    };
    canvasRef.current?.setPatientMarker(sprite);
  }, [estimate, nowMs]);

  // Floor-plan intelligence: derive a human "where / doing what" context from
  // the live indoor position vs placed furniture, rooms, and doors/windows.
  const furniture = useMemo(
    () => extractFurniture(planQuery.data?.canvas_json ?? null),
    [planQuery.data?.canvas_json],
  );
  const locCtx = useMemo(() => {
    if (
      estimate == null ||
      estimate.mode !== 'indoor' ||
      estimate.x_canvas == null ||
      estimate.y_canvas == null
    ) {
      return null;
    }
    return computeLocationContext(
      { x: estimate.x_canvas, y: estimate.y_canvas },
      roomsQuery.data ?? [],
      connectorsQuery.data ?? [],
      furniture,
      planQuery.data?.scale_meters_per_pixel ?? null,
    );
  }, [
    estimate,
    roomsQuery.data,
    connectorsQuery.data,
    furniture,
    planQuery.data?.scale_meters_per_pixel,
  ]);

  if (planQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="aspect-[4/3] max-h-[720px] min-h-[280px] sm:min-h-[420px] w-full" />
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowDiagnostics((v) => !v)}
              aria-expanded={showDiagnostics}
              aria-controls="beacon-diagnostics"
              className="text-[10px] uppercase tracking-wide text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {showDiagnostics ? 'Hide diagnostics' : 'Diagnostics'}
            </button>
            <ModeIndicator estimate={estimate} />
          </div>
        </div>
        {locCtx && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
              locCtx.tone === 'warn'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'bg-muted/50 text-foreground',
            )}
          >
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="font-medium">{locCtx.text}</span>
            {locCtx.detail && <span className="text-muted-foreground">· {locCtx.detail}</span>}
          </div>
        )}
        <div className="aspect-[4/3] max-h-[720px] min-h-[280px] sm:min-h-[420px] w-full overflow-hidden rounded-lg border border-border bg-card">
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
        {showDiagnostics && (
          <div id="beacon-diagnostics" className="border-t border-border pt-3">
            <BeaconDiagnosticsPanel patientId={patientId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
