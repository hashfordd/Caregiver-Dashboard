import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useCurrentCaregiver } from '@/features/provider/providerQueries';

// Gate route — once auth has resolved, redirect to /onboarding if the
// caregiver hasn't bound to a provider yet (new signup who needs to
// either create a provider or accept an invite).
export function RequireProviderBound() {
  const me = useCurrentCaregiver();
  const location = useLocation();

  if (me.isLoading) {
    return (
      <main className="grid min-h-[40vh] place-items-center px-6">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  // No caregiver row yet (first-tick after signup) — wait.
  if (!me.data) {
    return <Outlet />;
  }

  if (!me.data.care_provider_id) {
    return <Navigate to="/onboarding" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
