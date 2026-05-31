import { Outlet } from 'react-router-dom';
import { AppNavbar } from '@/components/AppNavbar';
import { AlertBanner } from '@/features/alerts/AlertBanner';
import { AlertCueHost } from '@/features/alerts/AlertCueHost';
import { LiveDataLostBanner } from '@/components/LiveDataLostBanner';
import { useTemperatureUnitSync } from '@/lib/units/temperature';

// Wraps every authed route with the top navbar. Renders the matched child
// route via <Outlet />. AlertCueHost subscribes to allocated-patient
// alerts so audible / desktop / screen-reader cues fire from any route.
// LiveDataLostBanner surfaces a loud, sticky warning whenever any realtime
// channel has gone offline, so monitoring never fails silently.
export function AppLayout() {
  // Hydrate the app-wide temperature-unit preference from the caregiver
  // profile once, here at the shell.
  useTemperatureUnitSync();
  return (
    <div className="min-h-screen bg-background">
      <LiveDataLostBanner />
      <AppNavbar />
      <AlertBanner />
      <AlertCueHost />
      <Outlet />
    </div>
  );
}
