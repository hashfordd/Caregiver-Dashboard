import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAcceptInvite, useCurrentCaregiver } from '@/features/provider/providerQueries';

// /invite#<token> — clicked from an admin's invite link.
//
// SEC: the token is carried in the URL *fragment*, not the path, so it
// never reaches the server (access logs) or the Referer header. It is
// threaded through the /login bounce via location state + the preserved
// hash so the round-trip survives an unauthenticated click.
//
// Three states:
//   1. Not authenticated → redirect to /login with state.from carrying
//      the invite path + hash so LoginPage returns here after sign-in.
//   2. Already in a provider → can't accept (server would refuse anyway);
//      bounce to /patients with an explanatory toast in the URL state.
//   3. Authenticated, no provider yet → show "Accept" button which
//      calls accept_invite. On success, land in /patients.
export function AcceptInvitePage() {
  const location = useLocation();
  // Token from the fragment (#<token>); fall back to router state for the
  // post-login round-trip in case the hash was stripped en route.
  const hashToken = location.hash ? decodeURIComponent(location.hash.replace(/^#/, '')) : '';
  const stateToken = (location.state as { token?: string } | null)?.token ?? '';
  const token = hashToken || stateToken || undefined;
  const { session, loading } = useAuth();
  const me = useCurrentCaregiver();
  const navigate = useNavigate();
  const accept = useAcceptInvite();

  // While auth is loading we don't know yet — render a placeholder.
  if (loading) {
    return (
      <main className="grid min-h-[40vh] place-items-center px-6">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!session) {
    // Bounce to /login with the invite location preserved so LoginPage's
    // state.from logic returns us here. Pass the token in state too so
    // the Onboarding page can pre-fill it as a fallback.
    return (
      <Navigate
        to="/login"
        state={{ from: { pathname: '/invite', hash: location.hash }, token }}
        replace
      />
    );
  }

  if (me.data?.care_provider_id) {
    return <Navigate to="/patients" replace />;
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Accept invite</CardTitle>
          <CardDescription>
            You're about to join a care provider. Continue to bind this account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {accept.isError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {(accept.error as Error).message}
            </p>
          )}
          <Button
            className="w-full"
            disabled={accept.isPending || !token}
            onClick={() =>
              token &&
              accept.mutate(token, { onSuccess: () => navigate('/patients', { replace: true }) })
            }
          >
            {accept.isPending ? 'Joining…' : 'Accept and join'}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate('/onboarding', { state: { token }, replace: true })}
          >
            Use a different option
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
