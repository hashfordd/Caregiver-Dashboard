// Centralised access to import.meta.env. Keep call sites typed and the
// "missing key → graceful degrade vs. fail-fast" decision in one place.
//
// Supabase keys are required (the app can't boot without them). Mapbox is
// optional — F9's OutdoorMapView checks `mapboxToken` and renders a
// placeholder when absent so CI builds and developers without a token
// can still run everything else.

const env = import.meta.env;

export const supabaseUrl: string = env.VITE_SUPABASE_URL ?? '';
export const supabaseAnonKey: string = env.VITE_SUPABASE_ANON_KEY ?? '';
export const mapboxToken: string = env.VITE_MAPBOX_TOKEN ?? '';

export function hasMapboxToken(): boolean {
  return mapboxToken.trim().length > 0;
}
