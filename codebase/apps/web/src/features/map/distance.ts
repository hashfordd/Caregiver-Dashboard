// Spherical-Earth Haversine distance. ~0.3% error at the worst point —
// fine for "how far is the patient from home" UI, where caregivers care
// about ballpark hundreds-of-metres precision, not surveyor's accuracy.

const EARTH_RADIUS_M = 6_371_000;
const RAD_PER_DEG = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineMetres(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD_PER_DEG;
  const dLng = (b.lng - a.lng) * RAD_PER_DEG;
  const lat1 = a.lat * RAD_PER_DEG;
  const lat2 = b.lat * RAD_PER_DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Human-readable distance string. Switches metres → km at the 1 km mark
 *  and tightens precision past 10 km so the UI doesn't show "12.3 km"
 *  when caregivers only need "12 km". */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
