import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  // Item 113: only show the loading state on cold-load (no cached
  // session). On revalidation we still have a session — render the
  // tree so navigation feels instant; the auth listener will redirect
  // if the session actually expired.
  if (loading && !session) {
    return (
      <main className="min-h-screen grid place-items-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
