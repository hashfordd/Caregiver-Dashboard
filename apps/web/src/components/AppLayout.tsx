import { Outlet } from 'react-router-dom';
import { AppNavbar } from '@/components/AppNavbar';

// Wraps every authed route with the top navbar. Renders the matched child
// route via <Outlet />.
export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <AppNavbar />
      <Outlet />
    </div>
  );
}
