import { Navigate, Outlet } from 'react-router-dom';
import { useCurrentCaregiver } from '@/features/provider/providerQueries';

export function RequireProviderAdmin() {
  const me = useCurrentCaregiver();

  if (me.isLoading) {
    return (
      <main className="grid min-h-[40vh] place-items-center px-6">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (me.data?.provider_role !== 'admin') {
    return <Navigate to="/patients" replace />;
  }

  return <Outlet />;
}
