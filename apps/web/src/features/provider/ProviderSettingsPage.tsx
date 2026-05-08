import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, Shield, Trash, User as UserIcon } from 'lucide-react';
import type { CaregiverProviderRole } from '@alzcare/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/AuthProvider';
import { InviteCaregiverDialog } from '@/features/provider/InviteCaregiverDialog';
import {
  useCurrentCaregiver,
  useCurrentProvider,
  useProviderInvites,
  useProviderMembers,
  useRevokeInvite,
  useUpdateMemberRole,
  useUpdateProviderName,
} from '@/features/provider/providerQueries';

export function ProviderSettingsPage() {
  const me = useCurrentCaregiver();
  const provider = useCurrentProvider();
  const members = useProviderMembers();
  const invites = useProviderInvites();
  const isAdmin = me.data?.provider_role === 'admin';

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Care provider</p>
        <h1 className="font-serif italic text-4xl text-foreground">
          {provider.data?.name ?? 'Provider settings'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your provider, teammates, and pending invites.
        </p>
      </header>

      <div className="space-y-6">
        <ProviderNameSection />
        <MembersSection canAdmin={isAdmin} />
        {isAdmin && <InvitesSection />}
        <BillingPlaceholder />
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        {members.data?.length ?? 0} member{members.data?.length === 1 ? '' : 's'} ·{' '}
        {invites.data?.length ?? 0} pending invite{invites.data?.length === 1 ? '' : 's'}
      </p>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────────

function ProviderNameSection() {
  const me = useCurrentCaregiver();
  const provider = useCurrentProvider();
  const update = useUpdateProviderName();
  const isAdmin = me.data?.provider_role === 'admin';
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } });

  // Sync form when provider data lands.
  useEffect(() => {
    if (provider.data) form.reset({ name: provider.data.name });
  }, [provider.data, form]);

  if (!provider.data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Loading provider…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Name</CardTitle>
        <CardDescription>What teammates and patients see.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={form.handleSubmit((values) =>
            update.mutate({ providerId: provider.data!.id, name: values.name.trim() }),
          )}
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="provider_name">Provider name</Label>
            <Input
              id="provider_name"
              disabled={!isAdmin}
              {...form.register('name', { required: true, maxLength: 120 })}
            />
          </div>
          {isAdmin && (
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form>
        {update.isError && (
          <p className="mt-3 text-sm text-destructive">{(update.error as Error).message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MembersSection({ canAdmin }: { canAdmin: boolean }) {
  const me = useCurrentCaregiver();
  const members = useProviderMembers();
  const updateRole = useUpdateMemberRole();
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Members</CardTitle>
          <CardDescription>Caregivers in this provider.</CardDescription>
        </div>
        {canAdmin && (
          <Button onClick={() => setInviteOpen(true)} size="sm">
            <Plus className="h-4 w-4" />
            Invite
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {members.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {members.isSuccess && members.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        )}
        {members.isSuccess && members.data.length > 0 && (
          <ul className="divide-y divide-border/60">
            {members.data.map((m) => {
              const isSelf = m.id === me.data?.id;
              const role = m.provider_role ?? 'member';
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-space-400 text-eggshell-500">
                      {role === 'admin' ? (
                        <Shield className="h-4 w-4" />
                      ) : (
                        <UserIcon className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.full_name}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                        )}
                      </p>
                      {/* Item 86: peer email is not exposed; show role
                          instead so the row still has a secondary line. */}
                      <p className="truncate text-xs text-muted-foreground">
                        {role === 'admin' ? 'Administrator' : 'Member'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
                      {role === 'admin' ? 'Admin' : 'Member'}
                    </Badge>
                    {canAdmin && !isSelf && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateRole.isPending}
                        onClick={() =>
                          updateRole.mutate({
                            caregiverId: m.id,
                            role: (role === 'admin' ? 'member' : 'admin') as CaregiverProviderRole,
                          })
                        }
                      >
                        {role === 'admin' ? 'Demote' : 'Make admin'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <InviteCaregiverDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </Card>
  );
}

function InvitesSection() {
  const invites = useProviderInvites();
  const revoke = useRevokeInvite();
  const { user } = useAuth();
  const meId = user?.id;

  if (!invites.data || invites.data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invites</CardTitle>
        <CardDescription>Tokens issued but not yet redeemed.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60">
          {invites.data.map((inv) => {
            const expired = new Date(inv.expires_at).getTime() <= Date.now();
            const inviteUrl = `${window.location.origin}/invite/${encodeURIComponent(inv.token)}`;
            return (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {inv.role} · expires {new Date(inv.expires_at).toLocaleString()}{' '}
                    {expired && <span className="text-destructive">(expired)</span>}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(inviteUrl).catch(() => {})}
                    className="mt-1 truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    title="Copy invite link"
                  >
                    {inviteUrl}
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoke.isPending || inv.invited_by !== meId}
                  onClick={() => revoke.mutate(inv.id)}
                  aria-label="Revoke invite"
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function BillingPlaceholder() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>Coming soon.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Billing-side controls will live here once subscription tiers ship.
        </p>
      </CardContent>
    </Card>
  );
}
