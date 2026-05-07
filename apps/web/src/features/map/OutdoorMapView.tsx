import { useEffect, useMemo, useState } from 'react';
import Map, { NavigationControl, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { MapPin, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { hasMapboxToken, mapboxToken } from '@/lib/env';
import { ModeIndicator } from '@/features/floor-plan/ModeIndicator';
import type { PositionEstimateRow } from '@/lib/usePatientStream';
import type { GeofencePolygon } from '@alzcare/shared/rules';

type GeofenceDirection = 'enter' | 'exit';
import { Breadcrumb } from './Breadcrumb';
import { GeofenceLayer } from './GeofenceLayer';
import { PatientPin } from './PatientPin';
import { useDeleteGeofence, useGeofenceRule, useUpsertGeofence } from './geofenceQueries';
import { useOutdoorTrail } from './useOutdoorTrail';
import { useNow } from './useNow';

interface OutdoorMapViewProps {
  patientId: string;
  /** Latest estimate from the unified PatientStream — surfaced so the
   *  map can centre on the live fix and so ModeIndicator stays in sync
   *  with the indoor view. */
  estimate: PositionEstimateRow | undefined;
}

const FALLBACK_CENTER = { latitude: -37.8136, longitude: 144.9631 }; // Melbourne CBD

export function OutdoorMapView({ patientId, estimate }: OutdoorMapViewProps) {
  // Token check is a thin shell so the hook-bearing component never mounts
  // when the map can't render — that keeps Rules-of-Hooks happy AND
  // avoids the breadcrumb fetch when the token is missing.
  if (!hasMapboxToken()) {
    return <MapUnavailable />;
  }
  return <OutdoorMapViewBody patientId={patientId} estimate={estimate} />;
}

function OutdoorMapViewBody({ patientId, estimate }: OutdoorMapViewProps) {
  const trail = useOutdoorTrail();
  const geofenceQuery = useGeofenceRule(patientId);
  const upsert = useUpsertGeofence();
  const remove = useDeleteGeofence();
  const nowMs = useNow(5_000);
  const [editing, setEditing] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<GeofencePolygon | null>(null);
  const [draftDirection, setDraftDirection] = useState<GeofenceDirection>('exit');
  const [mapRef, setMapRef] = useState<MapRef | null>(null);

  // Sync the draft polygon with the persisted one when the server-side
  // rule changes (initial load, or another tab updating it).
  useEffect(() => {
    setDraftPolygon(geofenceQuery.data?.params.geofence ?? null);
    setDraftDirection(geofenceQuery.data?.params.direction ?? 'exit');
  }, [geofenceQuery.data]);

  // Fly to the latest fix when one arrives. Only re-fly when the
  // coordinate actually changes — avoids fighting the user when they
  // pan around manually.
  const center = useMemo(() => {
    if (estimate?.lat != null && estimate?.lng != null) {
      return { latitude: estimate.lat, longitude: estimate.lng };
    }
    const tail = trail.trail[trail.trail.length - 1];
    if (tail && tail.lat != null && tail.lng != null) {
      return { latitude: tail.lat, longitude: tail.lng };
    }
    return FALLBACK_CENTER;
  }, [estimate?.lat, estimate?.lng, trail.trail]);

  useEffect(() => {
    if (!mapRef) return;
    if (estimate?.lat == null || estimate?.lng == null) return;
    mapRef.easeTo({ center: [estimate.lng, estimate.lat], duration: 600 });
  }, [mapRef, estimate?.lat, estimate?.lng]);

  const dirty =
    editing &&
    JSON.stringify(draftPolygon) !== JSON.stringify(geofenceQuery.data?.params.geofence ?? null);

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Live position — outdoor</h3>
            <p className="text-xs text-muted-foreground">
              Mapbox view. Switches back to the floor plan once the wearable's GPS confidence drops.
            </p>
          </div>
          <ModeIndicator estimate={estimate} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Select
                value={draftDirection}
                onValueChange={(v) => setDraftDirection(v as GeofenceDirection)}
              >
                <SelectTrigger className="h-9 w-44" aria-label="Alert direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exit">Alert on exit</SelectItem>
                  <SelectItem value="enter">Alert on entry</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!draftPolygon || !dirty || upsert.isPending}
                onClick={() => {
                  if (!draftPolygon) return;
                  upsert.mutate(
                    {
                      patientId,
                      ruleId: geofenceQuery.data?.id,
                      polygon: draftPolygon,
                      direction: draftDirection,
                    },
                    { onSuccess: () => setEditing(false) },
                  );
                }}
              >
                <Save className="mr-1 h-4 w-4" /> Save geofence
              </Button>
              {geofenceQuery.data && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    remove.mutate(
                      { patientId, ruleId: geofenceQuery.data!.id },
                      { onSuccess: () => setEditing(false) },
                    )
                  }
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraftPolygon(geofenceQuery.data?.params.geofence ?? null);
                }}
              >
                Cancel
              </Button>
              {upsert.error && (
                <span className="text-xs text-destructive">{(upsert.error as Error).message}</span>
              )}
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <MapPin className="mr-1 h-4 w-4" />
              {geofenceQuery.data ? 'Edit geofence' : 'Draw geofence'}
            </Button>
          )}
        </div>
        <div className="h-[min(60vh,720px)] min-h-[480px] w-full overflow-hidden rounded-lg border border-border">
          <Map
            ref={(r) => setMapRef(r)}
            mapboxAccessToken={mapboxToken}
            initialViewState={{
              latitude: center.latitude,
              longitude: center.longitude,
              zoom: 16,
            }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            style={{ width: '100%', height: '100%' }}
          >
            <NavigationControl position="top-right" />
            <Breadcrumb trail={trail.trail} />
            <GeofenceLayer initial={draftPolygon} enabled={editing} onChange={setDraftPolygon} />
            {estimate != null && estimate.mode === 'outdoor' && (
              <PatientPin estimate={estimate} nowMs={nowMs} />
            )}
          </Map>
        </div>
        {estimate?.mode === 'outdoor' && estimate.lat != null && estimate.lng != null ? (
          <p className="text-xs text-muted-foreground">
            Last fix {new Date(estimate.recorded_at).toLocaleTimeString()} · confidence{' '}
            {Math.round((estimate.confidence ?? 0) * 100)}% · {estimate.lat.toFixed(5)},{' '}
            {estimate.lng.toFixed(5)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Waiting for an outdoor GPS fix — the marker will appear once the wearable's confidence
            crosses the threshold.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MapUnavailable() {
  return (
    <Card>
      <CardContent className="pt-6">
        <EmptyState
          icon={<MapPin className="h-10 w-10" />}
          title="Map unavailable"
          description="Set VITE_MAPBOX_TOKEN in apps/web/.env.local to enable the outdoor map. Indoor positioning still works without it."
        />
      </CardContent>
    </Card>
  );
}
