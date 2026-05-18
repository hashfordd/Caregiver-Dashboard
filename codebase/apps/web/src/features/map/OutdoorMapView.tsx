import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Map, { NavigationControl, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { Home, LocateFixed, LocateOff, MapPin, Save, Trash2 } from 'lucide-react';
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
import { supabase } from '@/lib/supabase';
import { ModeIndicator } from '@/features/floor-plan/ModeIndicator';
import type { PositionEstimateRow } from '@/lib/usePatientStream';
import type { Patient } from '@alzcare/shared';
import type { GeofencePolygon } from '@alzcare/shared/rules';

type GeofenceDirection = 'enter' | 'exit';
import { Breadcrumb } from './Breadcrumb';
import { CareSettingMarker } from './CareSettingMarker';
import { CaregiverPin } from './CaregiverPin';
import { GeofenceLayer } from './GeofenceLayer';
import { PatientPin } from './PatientPin';
import { SetCareSettingDialog } from './SetCareSettingDialog';
import { formatDistance, haversineMetres } from './distance';
import { useDeleteGeofence, useGeofenceRule, useUpsertGeofence } from './geofenceQueries';
import { useCaregiverLocation } from './useCaregiverLocation';
import { useOutdoorTrail } from './useOutdoorTrail';
import { useNow } from './useNow';

interface OutdoorMapViewProps {
  patientId: string;
  /** Latest estimate from the unified PatientStream — surfaced so the
   *  map can centre on the live fix and ModeIndicator stays in sync with
   *  the indoor view. */
  estimate: PositionEstimateRow | undefined;
}

const FALLBACK_CENTER = { latitude: -37.8136, longitude: 144.9631 }; // Melbourne CBD

// Mirrors PatientDetailPage.PATIENT_COLUMNS so the React Query cache
// hit for ['patients', 'detail', id] returns a fully-shaped row.
const PATIENT_COLUMNS =
  'id, full_name, dob, description, care_provider_id, created_at, ' +
  'dementia_stage, wandering_risk, known_triggers, care_plan_summary, preferences, ' +
  'care_setting_lat, care_setting_lng, care_setting_label';

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
  const caregiverLocation = useCaregiverLocation();
  const [editing, setEditing] = useState(false);
  const [careSettingOpen, setCareSettingOpen] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<GeofencePolygon | null>(null);
  const [draftDirection, setDraftDirection] = useState<GeofenceDirection>('exit');
  const [mapRef, setMapRef] = useState<MapRef | null>(null);

  // Patient row — re-uses PatientDetailPage's cache when both are mounted.
  const patientQuery = useQuery({
    queryKey: ['patients', 'detail', patientId],
    queryFn: async (): Promise<Patient | null> => {
      const { data, error } = await supabase
        .from('patients')
        .select(PATIENT_COLUMNS)
        .eq('id', patientId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Patient) ?? null;
    },
  });
  const patient = patientQuery.data;
  const patientFirstName = patient?.full_name?.split(/\s+/)[0] ?? null;
  // Memoised so downstream useMemo deps don't re-fire each render with a
  // fresh `{ lat, lng }` object reference.
  const careSettingPoint = useMemo(
    () =>
      patient?.care_setting_lat != null && patient?.care_setting_lng != null
        ? { lat: patient.care_setting_lat, lng: patient.care_setting_lng }
        : null,
    [patient?.care_setting_lat, patient?.care_setting_lng],
  );

  // Sync the draft polygon with the persisted one when the server-side
  // rule changes (initial load, or another tab updating it).
  //
  // Phase F item 51: skip the sync while the user is editing — a
  // background refetch landing mid-edit (TanStack revalidation, page
  // focus, another tab's update) would otherwise stomp the in-progress
  // polygon and reset the direction picker. The sync resumes the next
  // time `editing` flips back to false.
  useEffect(() => {
    if (editing) return;
    setDraftPolygon(geofenceQuery.data?.params.geofence ?? null);
    setDraftDirection(geofenceQuery.data?.params.direction ?? 'exit');
  }, [geofenceQuery.data, editing]);

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
    if (careSettingPoint) {
      return { latitude: careSettingPoint.lat, longitude: careSettingPoint.lng };
    }
    return FALLBACK_CENTER;
  }, [estimate?.lat, estimate?.lng, trail.trail, careSettingPoint]);

  useEffect(() => {
    if (!mapRef) return;
    if (estimate?.lat == null || estimate?.lng == null) return;
    mapRef.easeTo({ center: [estimate.lng, estimate.lat], duration: 600 });
  }, [mapRef, estimate?.lat, estimate?.lng]);

  // Distance from the patient's current fix to the care setting.
  // Recomputed cheaply — Haversine is ~10 ops.
  const distanceMetres = useMemo(() => {
    if (!careSettingPoint) return null;
    if (estimate?.lat == null || estimate?.lng == null || estimate.mode !== 'outdoor') return null;
    return haversineMetres({ lat: estimate.lat, lng: estimate.lng }, careSettingPoint);
  }, [careSettingPoint, estimate?.lat, estimate?.lng, estimate?.mode]);

  function toggleCaregiverTracking() {
    if (caregiverLocation.status === 'tracking' || caregiverLocation.status === 'requesting') {
      caregiverLocation.stop();
    } else {
      caregiverLocation.start();
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Live position — outdoor</h3>
            <p className="text-xs text-muted-foreground">
              Mapbox view of the patient's latest GPS fix, their care setting, and (opt-in) your own
              location.
            </p>
          </div>
          <ModeIndicator estimate={estimate} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCareSettingOpen(true)}
            aria-label="Set care setting location"
          >
            <Home className="mr-1 h-4 w-4" />
            {careSettingPoint ? 'Edit care setting' : 'Set care setting'}
          </Button>
          <Button
            size="sm"
            variant={caregiverLocation.status === 'tracking' ? 'default' : 'outline'}
            onClick={toggleCaregiverTracking}
            aria-label="Toggle showing your own location"
          >
            {caregiverLocation.status === 'tracking' ||
            caregiverLocation.status === 'requesting' ? (
              <>
                <LocateOff className="mr-1 h-4 w-4" /> Hide my location
              </>
            ) : (
              <>
                <LocateFixed className="mr-1 h-4 w-4" /> Show my location
              </>
            )}
          </Button>
          {editing ? (
            <>
              {/* `dirty` removed from the disabled gate: re-saving an
                  unchanged polygon is idempotent and we don't want a
                  bug in the diff check to silently block Save. */}
              <Button
                size="sm"
                disabled={!draftPolygon || upsert.isPending}
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
                <Save className="mr-1 h-4 w-4" />
                {upsert.isPending
                  ? 'Saving…'
                  : draftPolygon
                    ? 'Save geofence'
                    : 'Draw a polygon first'}
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
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <MapPin className="mr-1 h-4 w-4" />
              {geofenceQuery.data ? 'Edit geofence' : 'Draw geofence'}
            </Button>
          )}
        </div>
        {editing && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">
              {draftPolygon ? (
                <>
                  ✓ Polygon captured ({Math.max(0, draftPolygon.coordinates.length - 1)} vertices).
                  Confirm the alert preference and click <strong>Save geofence</strong>.
                </>
              ) : (
                <>
                  Click on the map to drop boundary points. Drop at least 3 — then{' '}
                  <strong>double-click</strong> the last point (or click the first one again) to
                  close the shape. If the polygon icon isn't already highlighted top-left of the
                  map, click it first.
                </>
              )}
            </p>
            <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
              <label
                htmlFor="geofence-direction"
                className="text-xs font-medium text-foreground sm:whitespace-nowrap"
              >
                Notify caregivers when {patientFirstName ?? 'the patient'}
              </label>
              <Select
                value={draftDirection}
                onValueChange={(v) => setDraftDirection(v as GeofenceDirection)}
              >
                <SelectTrigger
                  id="geofence-direction"
                  className="h-9 w-full sm:w-60"
                  aria-label="Alert direction"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exit">leaves this area (alert on exit)</SelectItem>
                  <SelectItem value="enter">enters this area (alert on entry)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Saving creates a <span className="font-medium">warn</span>-severity alert rule wired
              to the rules engine — it fires automatically on the next outdoor GPS fix that breaches
              this boundary.
            </p>
          </div>
        )}
        {upsert.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <span className="font-medium">Couldn't save the geofence:</span>{' '}
            {(upsert.error as Error).message}
          </div>
        )}
        {caregiverLocation.status === 'denied' && (
          <p className="text-xs text-destructive">
            Location permission was denied. Update your browser site settings to enable.
          </p>
        )}
        {caregiverLocation.status === 'error' && caregiverLocation.error && (
          <p className="text-xs text-destructive">
            Couldn't read your location: {caregiverLocation.error}
          </p>
        )}
        {caregiverLocation.status === 'unsupported' && (
          <p className="text-xs text-destructive">
            This browser doesn't expose the Geolocation API.
          </p>
        )}
        <div className="aspect-[4/3] max-h-[720px] min-h-[280px] sm:min-h-[420px] w-full overflow-hidden rounded-lg border border-border">
          <Map
            ref={setMapRef}
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
            {careSettingPoint && (
              <CareSettingMarker
                lat={careSettingPoint.lat}
                lng={careSettingPoint.lng}
                label={patient?.care_setting_label ?? null}
              />
            )}
            {caregiverLocation.position && (
              <CaregiverPin
                lat={caregiverLocation.position.lat}
                lng={caregiverLocation.position.lng}
                accuracy={caregiverLocation.position.accuracy}
              />
            )}
            {estimate != null && estimate.mode === 'outdoor' && (
              <PatientPin estimate={estimate} name={patientFirstName} nowMs={nowMs} />
            )}
          </Map>
        </div>
        {estimate?.mode === 'outdoor' && estimate.lat != null && estimate.lng != null ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Last fix {new Date(estimate.recorded_at).toLocaleTimeString()} · confidence{' '}
              {Math.round((estimate.confidence ?? 0) * 100)}% · {estimate.lat.toFixed(5)},{' '}
              {estimate.lng.toFixed(5)}
            </p>
            {distanceMetres != null && (
              <p>
                <span className="font-medium text-foreground">{patientFirstName ?? 'Patient'}</span>{' '}
                is{' '}
                <span className="font-medium text-foreground">
                  {formatDistance(distanceMetres)}
                </span>{' '}
                from {patient?.care_setting_label?.trim() || 'the care setting'}.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Waiting for an outdoor GPS fix — the marker will appear once the wearable's confidence
            crosses the threshold.
          </p>
        )}
      </CardContent>
      <SetCareSettingDialog
        open={careSettingOpen}
        onOpenChange={setCareSettingOpen}
        patientId={patientId}
        initialLat={patient?.care_setting_lat ?? null}
        initialLng={patient?.care_setting_lng ?? null}
        initialLabel={patient?.care_setting_label ?? null}
        latestEstimate={estimate}
      />
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
