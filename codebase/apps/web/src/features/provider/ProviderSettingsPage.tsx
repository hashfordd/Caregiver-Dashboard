import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  History,
  NotebookText,
  Pill,
  Plus,
  Shield,
  Stethoscope,
  Timer,
  Trash,
  User as UserIcon,
  Users,
} from 'lucide-react';
import type { CaregiverProviderRole } from '@alzcare/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { InviteCaregiverDialog } from '@/features/provider/InviteCaregiverDialog';
import {
  useCurrentCaregiver,
  useCurrentProvider,
  useProviderAuditLog,
  useProviderInvites,
  useProviderMembers,
  useProviderOverview,
  useRevokeInvite,
  useUpdateMemberRole,
  useUpdateProviderName,
  type ProviderAuditEntry,
} from '@/features/provider/providerQueries';
import { formatRelativeAge } from '@/features/dashboard/connectionStatus';

const TAB_KEYS = ['overview', 'members', 'audit', 'settings'] as const;
type TabKey = (typeof TAB_KEYS)[number];
function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

export function ProviderSettingsPage() {
  const me = useCurrentCaregiver();
  const provider = useCurrentProvider();
  const isAdmin = me.data?.provider_role === 'admin';

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') ?? 'overview';
  const value: TabKey = isTabKey(tabParam) ? tabParam : 'overview';

  function setValue(next: string) {
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('tab', next);
        return updated;
      },
      { replace: true },
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Care provider</p>
        <h1 className="font-serif italic text-3xl text-foreground sm:text-4xl">
          {provider.data?.name ?? 'Provider home'}
        </h1>
        <p className="text-sm text-muted-foreground">
          The team behind the dashboard — KPIs, members, and the audit trail.
        </p>
      </header>

      <Tabs value={value} onValueChange={setValue}>
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="audit" disabled={!isAdmin}>
            Audit log
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="members">
          <MembersSection canAdmin={isAdmin} />
          {isAdmin && (
            <div className="mt-6">
              <InvitesSection />
            </div>
          )}
        </TabsContent>
        <TabsContent value="audit">
          {isAdmin ? (
            <AuditLogTab />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Admin only</CardTitle>
                <CardDescription>
                  The audit log is restricted to provider administrators.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="settings">
          <div className="space-y-6">
            <ProviderNameSection />
            <BillingPlaceholder />
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview tab
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab() {
  const overview = useProviderOverview();

  if (overview.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (overview.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Couldn't load the overview</CardTitle>
          <CardDescription>{(overview.error as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = overview.data;
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No provider yet</CardTitle>
          <CardDescription>
            Bind to a provider via the onboarding flow to see this overview.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const ackLabel =
    data.avg_ack_minutes_7d == null
      ? '—'
      : data.avg_ack_minutes_7d < 1
        ? '<1 min'
        : `${data.avg_ack_minutes_7d.toFixed(1)} min`;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        <KPI
          icon={<Stethoscope className="h-4 w-4" />}
          label="Patients managed"
          value={data.patient_count}
        />
        <KPI
          icon={<Users className="h-4 w-4" />}
          label="Caregivers"
          value={data.caregiver_count}
          hint={`${data.admin_count} admin${data.admin_count === 1 ? '' : 's'}`}
        />
        <KPI
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Open alerts"
          value={data.open_alerts_count}
          tone={data.open_alerts_count > 0 ? 'warn' : 'neutral'}
        />
        <KPI
          icon={<ClipboardList className="h-4 w-4" />}
          label="Incidents 24h"
          value={data.unresolved_incidents_24h}
          tone={data.unresolved_incidents_24h > 0 ? 'warn' : 'neutral'}
        />
        <KPI icon={<Pill className="h-4 w-4" />} label="Doses 24h" value={data.doses_logged_24h} />
        <KPI
          icon={<NotebookText className="h-4 w-4" />}
          label="Notes 24h"
          value={data.notes_logged_24h}
        />
        <KPI
          icon={<Timer className="h-4 w-4" />}
          label="Avg ack 7d"
          stringValue={ackLabel}
          hint="From fired_at → acknowledged_at"
        />
        <KPI
          icon={<Activity className="h-4 w-4" />}
          label="Activity 24h"
          value={data.doses_logged_24h + data.notes_logged_24h + data.unresolved_incidents_24h}
          hint="Doses + notes + new incidents"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>What this tells you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>Open alerts</strong> + <strong>Incidents 24h</strong> are your "what needs
            attention right now" pair. <strong>Avg ack</strong> is the team's responsiveness
            baseline — drift upward means re-prioritising or re-staffing.
          </p>
          <p>
            <strong>Doses</strong> + <strong>Notes</strong> reflect documentation volume. Days with
            high doses but zero notes often correlate with a missed observation pass — worth
            reviewing the audit log.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type KPITone = 'neutral' | 'warn';

function KPI({
  icon,
  label,
  value,
  stringValue,
  hint,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  stringValue?: string;
  hint?: string;
  tone?: KPITone;
}) {
  const display = stringValue ?? (typeof value === 'number' ? value : '—');
  return (
    <div
      className={cn(
        'rounded-lg border bg-card px-4 py-3',
        tone === 'warn' && 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p
        className={cn(
          'mt-1 font-serif italic text-3xl tabular-nums',
          tone === 'warn' && 'text-amber-700 dark:text-amber-300',
        )}
      >
        {display}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit log tab
// ─────────────────────────────────────────────────────────────────────────────

function AuditLogTab() {
  const log = useProviderAuditLog(100);

  if (log.isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (log.isError) {
    return <p className="text-sm text-destructive">{(log.error as Error).message}</p>;
  }

  const rows = log.data ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No audit entries yet</CardTitle>
          <CardDescription>
            Every write across patients, devices, alerts, incidents, meds, and notes is recorded
            here. Activity will appear as caregivers operate.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Last {rows.length} write{rows.length === 1 ? '' : 's'} across the tenant.
          </CardDescription>
        </div>
        <History className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y divide-border/40">
          {rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AuditRow({ row }: { row: ProviderAuditEntry }) {
  const action = row.action.toLowerCase();
  const tone =
    action === 'delete'
      ? 'text-red-700 bg-red-500/10 dark:text-red-300'
      : action === 'insert'
        ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
        : 'text-sky-700 bg-sky-500/10 dark:text-sky-300';

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            'inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide',
            tone,
          )}
        >
          {row.action}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm">
            <span className="font-medium">{row.target_table ?? 'unknown'}</span>
            {row.target_id && (
              <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                {row.target_id.slice(0, 8)}
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {row.actor_name ?? 'system'} · {formatRelativeAge(row.occurred_at)}
          </p>
        </div>
      </div>
      <span className="hidden whitespace-nowrap text-[11px] text-muted-foreground sm:inline">
        {new Date(row.occurred_at).toLocaleString()}
      </span>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings tab pieces (existing, kept verbatim where possible)
// ─────────────────────────────────────────────────────────────────────────────

function ProviderNameSection() {
  const me = useCurrentCaregiver();
  const provider = useCurrentProvider();
  const update = useUpdateProviderName();
  const isAdmin = me.data?.provider_role === 'admin';
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } });

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
                  <div className="flex min-w-0 items-center gap-3">
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
