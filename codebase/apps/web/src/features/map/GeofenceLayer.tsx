import { useEffect, useRef } from 'react';
import { useControl } from 'react-map-gl/mapbox';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type { GeofencePolygon } from '@alzcare/shared/rules';

interface GeofenceLayerProps {
  /** Persisted polygon to seed the draw control with. */
  initial: GeofencePolygon | null;
  /** Whether the draw control is interactive. */
  enabled: boolean;
  /** Fires whenever the user creates / edits / deletes the polygon. */
  onChange: (polygon: GeofencePolygon | null) => void;
}

/** Mounts MapboxDraw as a Mapbox control. The single-feature constraint
 *  is enforced here (a new polygon replaces any prior one) so the
 *  caregiver only manages one geofence per patient — F11 will lift this
 *  for multi-zone rules. */
export function GeofenceLayer({ initial, enabled, onChange }: GeofenceLayerProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Keep the draw instance reachable from the listener closures via a
  // stable ref. Set inside `onCreate`; cleared in `onRemove`.
  const drawRef = useRef<MapboxDraw | null>(null);
  // Listener identity must survive between onAdd / onRemove for `off()`
  // to actually detach.
  const listenersRef = useRef<{ create: () => void; change: () => void } | null>(null);

  const draw = useControl<MapboxDraw>(
    () => {
      const d = new MapboxDraw({
        displayControlsDefault: false,
        controls: enabled ? { polygon: true, trash: true } : {},
        defaultMode: enabled ? 'simple_select' : 'static',
      });
      drawRef.current = d;
      return d;
    },
    ({ map }) => {
      const change = () => emitCurrent(drawRef.current, onChangeRef.current);
      const create = () => {
        collapseToLatest(drawRef.current);
        change();
      };
      listenersRef.current = { create, change };
      // Mapbox typings don't model custom 'draw.*' events from
      // mapbox-gl-draw, but the runtime supports them.
      const m = map as unknown as { on: (e: string, h: () => void) => void };
      m.on('draw.create', create);
      m.on('draw.update', change);
      m.on('draw.delete', change);
    },
    ({ map }) => {
      const stash = listenersRef.current;
      if (stash) {
        const m = map as unknown as { off: (e: string, h: () => void) => void };
        m.off('draw.create', stash.create);
        m.off('draw.update', stash.change);
        m.off('draw.delete', stash.change);
      }
      listenersRef.current = null;
      drawRef.current = null;
    },
    { position: 'top-left' },
  );

  // Seed the draw control with the persisted polygon on mount + when
  // `initial` changes (e.g. after a server-side update).
  useEffect(() => {
    if (!draw) return;
    draw.deleteAll();
    if (initial) {
      draw.add({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [initial.coordinates] },
      });
    }
  }, [draw, initial]);

  return null;
}

function emitCurrent(
  draw: MapboxDraw | null,
  onChange: (polygon: GeofencePolygon | null) => void,
): void {
  if (!draw) return;
  const features = draw.getAll().features;
  const polygon = features.find((f) => f.geometry.type === 'Polygon');
  if (!polygon || polygon.geometry.type !== 'Polygon') {
    onChange(null);
    return;
  }
  const ring = polygon.geometry.coordinates[0] as [number, number][] | undefined;
  if (!ring || ring.length < 4) {
    onChange(null);
    return;
  }
  onChange({ type: 'polygon', coordinates: ring });
}

function collapseToLatest(draw: MapboxDraw | null): void {
  if (!draw) return;
  const features = draw.getAll().features;
  if (features.length <= 1) return;
  const latest = features[features.length - 1];
  if (!latest) return;
  for (const f of features) {
    if (f.id !== latest.id && f.id != null) draw.delete(String(f.id));
  }
}
