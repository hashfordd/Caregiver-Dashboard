import { Home } from 'lucide-react';
import { Marker } from 'react-map-gl/mapbox';

interface CareSettingMarkerProps {
  lat: number;
  lng: number;
  label?: string | null;
}

/** Static marker showing the patient's care setting (home base). Distinct
 *  from the live patient pin: orange tone, house icon, fixed position.
 *  The caregiver edits its coords via SetCareSettingDialog; the persisted
 *  values live on patients.care_setting_lat/lng/label. */
export function CareSettingMarker({ lat, lng, label }: CareSettingMarkerProps) {
  return (
    <Marker latitude={lat} longitude={lng} anchor="bottom">
      <div className="flex flex-col items-center">
        <div className="rounded-full bg-amber-600 p-1.5 text-white shadow-[0_0_0_3px_rgba(255,255,255,0.85)]">
          <Home className="h-4 w-4" aria-label="Care setting" />
        </div>
        <span className="mt-1 max-w-[12rem] truncate whitespace-nowrap rounded-md bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
          {label?.trim() || 'Care setting'}
        </span>
      </div>
    </Marker>
  );
}
