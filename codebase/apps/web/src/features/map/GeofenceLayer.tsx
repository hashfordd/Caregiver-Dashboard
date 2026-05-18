import { useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/mapbox';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type { GeofencePolygon } from '@alzcare/shared/rules';

interface GeofenceLayerProps {
  /** Persisted polygon to seed the draw control with. */
  initial: GeofencePolygon | null;
  /** Whether the draw control exposes the polygon/trash buttons and
   *  auto-enters drawing mode on mount. */
  enabled: boolean;
  /** Fires whenever the user creates / edits / deletes the polygon. */
  onChange: (polygon: GeofencePolygon | null) => void;
}

/** Mounts MapboxDraw and surfaces the current polygon to the parent.
 *
 *  Lifecycle is managed manually via `useMap()` + a single `useEffect`
 *  rather than `useControl` — `useControl` caches the MapboxDraw via
 *  `useMemo` with empty deps, which interacts badly with React
 *  StrictMode: the cleanup tears down the control's internal `ctx.store`
 *  via `removeControl`, but the second mount pass re-uses the same
 *  cached instance and `addControl` can't restore the stripped state.
 *  Result: `getAll()` throws "Cannot read properties of undefined" and
 *  events fire on a dead instance. Creating a fresh MapboxDraw per
 *  effect run side-steps the issue completely. */
export function GeofenceLayer({ initial, enabled, onChange }: GeofenceLayerProps) {
  const { current: mapRef } = useMap();

  // Refs so the listener closures always read the latest props without
  // re-running the whole effect on every prop change.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    const mapInstance = mapRef?.getMap();
    if (!mapInstance) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: enabled ? { polygon: true, trash: true } : {},
      // 'static' isn't a built-in mode in mapbox-gl-draw@1.5.x.
      defaultMode: 'simple_select',
    });

    mapInstance.addControl(draw, 'top-left');

    if (initialRef.current) {
      try {
        draw.add({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [initialRef.current.coordinates] },
        });
      } catch {
        // best-effort seed; the user can redraw if mapbox-gl-draw rejects it
      }
    } else if (enabled) {
      // No existing polygon and editing — drop straight into draw mode so
      // the user can click on the map immediately without hunting for the
      // small polygon icon top-left.
      try {
        draw.changeMode('draw_polygon');
      } catch {
        // mode change can throw if mapbox-gl-draw isn't fully ready;
        // the user can click the polygon icon manually if so.
      }
    }

    const emit = () => {
      let features: ReturnType<MapboxDraw['getAll']>['features'];
      try {
        features = draw.getAll().features;
      } catch {
        return;
      }
      const polygon = features.find((f) => f.geometry.type === 'Polygon');
      let next: GeofencePolygon | null = null;
      if (polygon && polygon.geometry.type === 'Polygon') {
        const ring = polygon.geometry.coordinates[0] as [number, number][] | undefined;
        if (ring && ring.length >= 4) {
          next = { type: 'polygon', coordinates: ring };
        }
      }
      onChangeRef.current(next);
    };

    // mapbox-gl-draw 1.5.x has been observed to skip draw.create on some
    // browser/build combos. Wire every plausible signal — modechange and
    // selectionchange both fire reliably when a polygon completes.
    const m = mapInstance as unknown as {
      on: (e: string, h: () => void) => void;
      off: (e: string, h: () => void) => void;
    };
    m.on('draw.create', emit);
    m.on('draw.update', emit);
    m.on('draw.delete', emit);
    m.on('draw.modechange', emit);
    m.on('draw.selectionchange', emit);

    return () => {
      m.off('draw.create', emit);
      m.off('draw.update', emit);
      m.off('draw.delete', emit);
      m.off('draw.modechange', emit);
      m.off('draw.selectionchange', emit);
      if (mapInstance.hasControl(draw)) {
        mapInstance.removeControl(draw);
      }
    };
    // `initial` deliberately excluded — re-seeding on every onChange would
    // deleteAll the user's in-progress polygon. The seed only matters on
    // first mount (or when toggling between view/edit, which re-runs this
    // effect via the `enabled` dep).
  }, [mapRef, enabled]);

  return null;
}
