import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useAcceptInvite,
  useCreateProvider,
  useCurrentCaregiver,
} from '@/features/provider/providerQueries';

type Mode = 'choose' | 'create' | 'accept';

// First-time provider binding. Reached when a caregiver has authenticated
// but has no care_provider_id yet — they must either create their own
// provider (becoming its admin) or paste an invite token.
export function OnboardingPage() {
  const me = useCurrentCaregiver();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('choose');
  const [name, setName] = useState('');
  const [token, setToken] = useState((location.state as { token?: string } | null)?.token ?? '');

  const createMutation = useCreateProvider();
  const acceptMutation = useAcceptInvite();

  // If we already have a provider, bounce to the dashboard.
  if (me.data?.care_provider_id) {
    return <Navigate to="/patients" replace />;
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate(name.trim(), { onSuccess: () => navigate('/patients', { replace: true }) });
  }

  function handleAccept(e: FormEvent) {
    e.preventDefault();
    acceptMutation.mutate(token.trim(), { onSuccess: () => navigate('/patients', { replace: true }) });
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <header className="mb-8 space-y-2 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Welcome</p>
        <h1 className="font-serif italic text-4xl text-foreground">Get set up</h1>
        <p className="text-sm text-muted-foreground">
          Either start a new care provider with you as admin, or accept an invite from an existing
          one.
        </p>
      </header>

      {mode === 'choose' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card
            role="button"
            tabIndex={0}
            onClick={() => setMode('create')}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setMode('create')}
            className="cursor-pointer transition-colors hover:border-accent"
          >
            <CardHeader>
              <CardTitle>Start a care provider</CardTitle>
              <CardDescription>
                For agencies, family carer groups, or solo professional caregivers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                You become the admin. Invite teammates and allocate patients later.
              </p>
            </CardContent>
          </Card>
          <Card
            role="button"
            tabIndex={0}
            onClick={() => setMode('accept')}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setMode('accept')}
            className="cursor-pointer transition-colors hover:border-accent"
          >
            <CardHeader>
              <CardTitle>Accept an invite</CardTitle>
              <CardDescription>You were sent a token by your provider's admin.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Paste the token and join their care provider.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {mode === 'create' && (
        <Card>
          <CardHeader>
            <CardTitle>Name your care provider</CardTitle>
            <CardDescription>This is what teammates and patients will see.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="provider_name">Provider name</Label>
                <Input
                  id="provider_name"
                  autoFocus
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="St. Vincent's Home Care"
                />
              </div>
              {createMutation.isError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {(createMutation.error as Error).message}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
                  {createMutation.isPending ? 'Creating…' : 'Create care provider'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setMode('choose')}>
                  Back
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {mode === 'accept' && (
        <Card>
          <CardHeader>
            <CardTitle>Accept invite</CardTitle>
            <CardDescription>Paste the token your admin shared with you.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAccept} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite_token">Invite token</Label>
                <Input
                  id="invite_token"
                  autoFocus
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="aBcDe…"
                />
              </div>
              {acceptMutation.isError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {(acceptMutation.error as Error).message}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={acceptMutation.isPending || !token.trim()}>
                  {acceptMutation.isPending ? 'Joining…' : 'Accept invite'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setMode('choose')}>
                  Back
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
