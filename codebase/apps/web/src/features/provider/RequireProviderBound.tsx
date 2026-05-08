import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useCurrentCaregiver } from '@/features/provider/providerQueries';

// Gate route — once auth has resolved, redirect to /onboarding if the
// caregiver hasn't bound to a provider yet (new signup who needs to
// either create a provider or accept an invite).
export function RequireProviderBound() {
  const me = useCurrentCaregiver();
  const location = useLocation();

  // Item 113: only flash the loading state when there's no cached
  // me.data; on revalidation render the cached tree to avoid the visible
  // flicker on every hard navigation under /patients, /alerts, /provider.
  if (me.isLoading && !me.data) {
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
