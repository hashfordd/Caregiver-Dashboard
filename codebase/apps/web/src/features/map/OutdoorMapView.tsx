import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Map, { Layer, NavigationControl, Source, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import {
  Home,
  LocateFixed,
  LocateOff,
  MapPin,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
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
import {
  useDeleteGeofence,
  useGeofenceRules,
  useUpsertGeofence,
  type OutdoorZoneRuleRow,
} from './geofenceQueries';
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

const PATIENT_COLUMNS =
  'id, full_name, dob, description, care_provider_id, created_at, ' +
  'dementia_stage, wandering_risk, known_triggers, care_plan_summary, preferences, ' +
  'care_setting_lat, care_setting_lng, care_setting_label';

/** Average of a polygon's vertices (excluding the closing duplicate), as a
 *  {lat,lng} point. Used to anchor the care-setting marker + distance read
 *  on the centre of the designated geofence. Coordinates are [lng, lat]. */
function polygonCentroid(poly: GeofencePolygon): { lat: number; lng: number } | null {
  const ring = poly.coordinates.slice(0, -1); // drop closing duplicate
  if (ring.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  return { lng: lng / ring.length, lat: lat / ring.length };
}

function geofenceLabel(rule: OutdoorZoneRuleRow, index: number): string {
  return rule.params.name?.trim() || `Geofence ${index + 1}`;
}

export function OutdoorMapView({ patientId, estimate }: OutdoorMapViewProps) {
  if (!hasMapboxToken()) {
    return <MapUnavailable />;
  }
  return <OutdoorMapViewBody patientId={patientId} estimate={estimate} />;
}

function OutdoorMapViewBody({ patientId, estimate }: OutdoorMapViewProps) {
  const trail = useOutdoorTrail();
  const geofencesQuery = useGeofenceRules(patientId);
  const upsert = useUpsertGeofence();
  const remove = useDeleteGeofence();
  const nowMs = useNow(5_000);
  const caregiverLocation = useCaregiverLocation();
  const [careSettingOpen, setCareSettingOpen] = useState(false);
  const [mapRef, setMapRef] = useState<MapRef | null>(null);
  const recenterOnCaregiverRef = useRef(false);

  const geofences = useMemo(() => geofencesQuery.data ?? [], [geofencesQuery.data]);

  // Editing state: which geofence is open in the draft editor — an existing
  // rule id, the sentinel 'new', or null when not editing. Only one geofence
  // is edited at a time; the rest render read-only.
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftPolygon, setDraftPolygon] = useState<GeofencePolygon | null>(null);
  const [draftDirection, setDraftDirection] = useState<GeofenceDirection>('exit');
  const [draftName, setDraftName] = useState('');
  const [draftCare, setDraftCare] = useState(false);

  const editing = editingId != null;

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

  // The care-setting boundary is whichever geofence is flagged; its centroid
  // becomes the home-base point (falling back to the patient row's point).
  const careGeofence = useMemo(
    () => geofences.find((g) => g.params.is_care_setting) ?? null,
    [geofences],
  );
  const careSettingPoint = useMemo(() => {
    if (careGeofence) {
      const c = polygonCentroid(careGeofence.params.geofence);
      if (c) return c;
    }
    return patient?.care_setting_lat != null && patient?.care_setting_lng != null
      ? { lat: patient.care_setting_lat, lng: patient.care_setting_lng }
      : null;
  }, [careGeofence, patient?.care_setting_lat, patient?.care_setting_lng]);

  const careSettingLabel =
    careGeofence != null
      ? geofenceLabel(careGeofence, geofences.indexOf(careGeofence))
      : patient?.care_setting_label?.trim() || 'the care setting';

  // GeoJSON for every saved geofence EXCEPT the one currently being edited
  // (that one is shown live via the draw control). Care-setting boundary is
  // tinted emerald; ordinary zones blue.
  const savedFeatures = useMemo(() => {
    const features = geofences
      .filter((g) => g.id !== editingId)
      .map((g, i) => ({
        type: 'Feature' as const,
        properties: { care: g.params.is_care_setting === true, name: geofenceLabel(g, i) },
        geometry: { type: 'Polygon' as const, coordinates: [g.params.geofence.coordinates] },
      }));
    return { type: 'FeatureCollection' as const, features };
  }, [geofences, editingId]);

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
    if (caregiverLocation.status === 'tracking' || caregiverLocation.status === 'requesting')
      return;
    if (estimate?.lat == null || estimate?.lng == null) return;
    mapRef.easeTo({ center: [estimate.lng, estimate.lat], duration: 600 });
  }, [mapRef, estimate?.lat, estimate?.lng, caregiverLocation.status]);

  useEffect(() => {
    if (!mapRef || !recenterOnCaregiverRef.current) return;
    const pos = caregiverLocation.position;
    if (!pos) return;
    mapRef.easeTo({ center: [pos.lng, pos.lat], zoom: 16, duration: 700 });
    recenterOnCaregiverRef.current = false;
  }, [mapRef, caregiverLocation.position]);

  const distanceMetres = useMemo(() => {
    if (!careSettingPoint) return null;
    if (estimate?.lat == null || estimate?.lng == null || estimate.mode !== 'outdoor') return null;
    return haversineMetres({ lat: estimate.lat, lng: estimate.lng }, careSettingPoint);
  }, [careSettingPoint, estimate?.lat, estimate?.lng, estimate?.mode]);

  function toggleCaregiverTracking() {
    if (caregiverLocation.status === 'tracking' || caregiverLocation.status === 'requesting') {
      caregiverLocation.stop();
    } else {
      recenterOnCaregiverRef.current = true;
      caregiverLocation.start();
    }
  }

  function startAdd() {
    setEditingId('new');
    setDraftPolygon(null);
    setDraftDirection('exit');
    setDraftName('');
    setDraftCare(geofences.length === 0); // first geofence defaults to the care setting
  }

  function startEdit(rule: OutdoorZoneRuleRow) {
    setEditingId(rule.id);
    setDraftPolygon(rule.params.geofence);
    setDraftDirection(rule.params.direction);
    setDraftName(rule.params.name ?? '');
    setDraftCare(rule.params.is_care_setting === true);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftPolygon(null);
  }

  function saveDraft() {
    if (!draftPolygon || editingId == null) return;
    const ruleId = editingId === 'new' ? undefined : editingId;
    upsert.mutate(
      {
        patientId,
        ruleId,
        polygon: draftPolygon,
        direction: draftDirection,
        name: draftName,
        isCareSetting: draftCare,
      },
      {
        onSuccess: () => {
          // Enforce a single care-setting boundary: if this one was just
          // designated, clear the flag on any other geofence that held it.
          if (draftCare) {
            for (const g of geofences) {
              if (g.id !== ruleId && g.params.is_care_setting) {
                upsert.mutate({
                  patientId,
                  ruleId: g.id,
                  polygon: g.params.geofence,
                  direction: g.params.direction,
                  name: g.params.name,
                  isCareSetting: false,
                });
              }
            }
          }
          cancelEdit();
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Live position — outdoor</h3>
            <p className="text-xs text-muted-foreground">
              Mapbox view of the patient's latest GPS fix, their geofences, and (opt-in) your own
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
            aria-label="Set care setting point"
          >
            <Home className="mr-1 h-4 w-4" />
            Care-setting point
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
          {!editing && (
            <Button size="sm" variant="outline" onClick={startAdd}>
              <Plus className="mr-1 h-4 w-4" /> Add geofence
            </Button>
          )}
        </div>

        {/* Saved geofences list (hidden while editing to keep focus on the
            draft). Each can be edited, deleted, or made the care setting. */}
        {!editing && geofences.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {geofences.map((g, i) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {geofenceLabel(g, i)}
                    </span>
                    {g.params.is_care_setting && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        <Star className="h-3 w-3" /> Care setting
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Alerts on {g.params.direction === 'exit' ? 'exit' : 'entry'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(g)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate({ patientId, ruleId: g.id })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editing && (
          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium text-foreground">
              {draftPolygon ? (
                <>
                  ✓ Polygon captured ({Math.max(0, draftPolygon.coordinates.length - 1)} vertices).
                </>
              ) : (
                <>
                  Click on the map to drop boundary points. Drop at least 3, then{' '}
                  <strong>double-click</strong> the last point to close the shape.
                </>
              )}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="geofence-name" className="text-xs font-medium text-foreground">
                  Name
                </label>
                <Input
                  id="geofence-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g. Back garden"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="geofence-direction" className="text-xs font-medium text-foreground">
                  Notify caregivers when {patientFirstName ?? 'the patient'}
                </label>
                <Select
                  value={draftDirection}
                  onValueChange={(v) => setDraftDirection(v as GeofenceDirection)}
                >
                  <SelectTrigger
                    id="geofence-direction"
                    className="h-9"
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
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={draftCare}
                onChange={(e) => setDraftCare(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Use this geofence as the care-setting boundary
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!draftPolygon || upsert.isPending} onClick={saveDraft}>
                <Save className="mr-1 h-4 w-4" />
                {upsert.isPending ? 'Saving…' : 'Save geofence'}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
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
            {/* Read-only saved geofences. */}
            <Source id="geofences" type="geojson" data={savedFeatures}>
              <Layer
                id="geofences-fill"
                type="fill"
                paint={{
                  'fill-color': ['case', ['get', 'care'], '#10b981', '#3b82f6'],
                  'fill-opacity': 0.12,
                }}
              />
              <Layer
                id="geofences-line"
                type="line"
                paint={{
                  'line-color': ['case', ['get', 'care'], '#10b981', '#3b82f6'],
                  'line-width': 2,
                }}
              />
            </Source>
            {/* Editable draft via the draw control (only while editing). */}
            <GeofenceLayer initial={draftPolygon} enabled={editing} onChange={setDraftPolygon} />
            {careSettingPoint && (
              <CareSettingMarker
                lat={careSettingPoint.lat}
                lng={careSettingPoint.lng}
                label={careGeofence ? careSettingLabel : (patient?.care_setting_label ?? null)}
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
                from {careSettingLabel}.
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
