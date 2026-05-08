import { Layer, Source } from 'react-map-gl/mapbox';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

interface BreadcrumbProps {
  trail: PositionEstimateRow[];
}

/** Renders the patient's last 30 minutes of outdoor positions as a
 *  fading line. Older points sit at lower opacity via line-gradient,
 *  so a fresh trail is bright and the trailing tail dims naturally.
 *
 *  No interaction — purely visual. The pin (sibling component) carries
 *  the live state and tooltip. */
export function Breadcrumb({ trail }: BreadcrumbProps) {
  const valid = trail.filter((r) => r.lat != null && r.lng != null);
  if (valid.length < 2) return null;
  const data = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: valid.map((r) => [r.lng as number, r.lat as number]),
    },
  };
  return (
    <Source id="patient-breadcrumb" type="geojson" data={data} lineMetrics>
      <Layer
        id="patient-breadcrumb-line"
        type="line"
        paint={{
          'line-width': 4,
          'line-color': '#0c4a6e',
          'line-gradient': [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            'rgba(12,74,110,0.15)',
            1,
            'rgba(12,74,110,0.95)',
          ],
        }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
    </Source>
  );
}
