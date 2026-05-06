import { Outlet } from 'react-router-dom';
import { AppNavbar } from '@/components/AppNavbar';
import { AlertCueHost } from '@/features/alerts/AlertCueHost';

// Wraps every authed route with the top navbar. Renders the matched child
// route via <Outlet />. AlertCueHost subscribes to allocated-patient
// alerts so audible / desktop / screen-reader cues fire from any route.
export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <AppNavbar />
      <AlertCueHost />
      <Outlet />
    </div>
  );
}
