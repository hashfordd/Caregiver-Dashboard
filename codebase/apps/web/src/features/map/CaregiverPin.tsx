import { Marker } from 'react-map-gl/mapbox';
import { Navigation } from 'lucide-react';

interface CaregiverPinProps {
  lat: number;
  lng: number;
  /** Accuracy radius in metres (browser Geolocation API). Surfaced as a
   *  tooltip so the caregiver can interpret how trustworthy the pin is. */
  accuracy: number;
}

/** "You are here" pin for the signed-in caregiver. Sourced from
 *  navigator.geolocation, NOT from any wearable feed — completely
 *  separate from PatientPin. Sky-blue to keep it visually distinct from
 *  the navy patient pin and the amber care-setting marker. */
export function CaregiverPin({ lat, lng, accuracy }: CaregiverPinProps) {
  return (
    <Marker latitude={lat} longitude={lng} anchor="center">
      <div
        className="flex flex-col items-center"
        title={`Your location · accuracy ±${Math.round(accuracy)} m`}
      >
        <div className="rounded-full bg-sky-600 p-1.5 text-white shadow-[0_0_0_3px_rgba(255,255,255,0.85)]">
          <Navigation className="h-4 w-4" />
        </div>
        <span className="mt-1 max-w-[12rem] truncate whitespace-nowrap rounded-md bg-sky-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
          You
        </span>
      </div>
    </Marker>
  );
}
