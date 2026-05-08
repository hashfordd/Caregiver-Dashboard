import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAllocatedAlerts } from '@/features/alerts/useAllocatedAlerts';
import { CreatePatientDialog } from '@/features/patients/CreatePatientDialog';
import { AlertStream } from './AlertStream';
import { LiveGrid } from './LiveGrid';
import { SituationHeader } from './SituationHeader';
import { deriveConnectionStatus } from './connectionStatus';
import { useSituationOverview } from './useSituationOverview';

export function SituationRoomPage() {
  const { user } = useAuth();
  const patientsQuery = useSituationOverview();
  const alerts = useAllocatedAlerts();
  const [createOpen, setCreateOpen] = useState(false);

  const firstName = useMemo(() => {
    const fullName = user?.user_metadata?.full_name as string | undefined;
    return fullName ? fullName.split(/\s+/)[0] : null;
  }, [user]);

  const patients = patientsQuery.data ?? [];
  const counts = useMemo(() => {
    let stale = 0;
    let offline = 0;
    let unresolvedIncidents = 0;
    const now = Date.now();
    for (const p of patients) {
      const status = deriveConnectionStatus(p.last_position_at, now);
      if (status === 'stale') stale += 1;
      else if (status === 'offline') offline += 1;
      unresolvedIncidents += p.unresolved_incidents_24h_count ?? 0;
    }
    return { stale, offline, unresolvedIncidents };
    // patientsQuery.dataUpdatedAt forces recompute on every poll tick
    // so the header counters track the same data the grid renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientsQuery.dataUpdatedAt]);

  const unackedAlerts = useMemo(
    () => alerts.rows.filter((r) => r.acknowledged_at == null),
    [alerts.rows],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Situation room</p>
          <h1 className="font-serif italic text-3xl text-foreground sm:text-4xl">
            {firstName ? `Welcome, ${firstName}.` : 'Welcome.'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Live status across every patient under your care.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="self-start sm:self-auto">
          <Plus className="h-4 w-4" />
          New patient
        </Button>
      </header>

      <div className="mb-6">
        <SituationHeader
          patientCount={patients.length}
          openAlertsCount={alerts.unackedCount}
          staleCount={counts.stale}
          offlineCount={counts.offline}
          unresolvedIncidentsCount={counts.unresolvedIncidents}
          hasCriticalAlert={alerts.hasCritical}
        />
      </div>

      {patientsQuery.isError && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Couldn't load the dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-destructive">
              {(patientsQuery.error as Error).message || 'Unknown error'}
            </p>
            <Button onClick={() => patientsQuery.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-label="Live patient grid" className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Patients ({patients.length})
          </h2>
          <LiveGrid
            patients={patients}
            unackedAlerts={unackedAlerts}
            isLoading={patientsQuery.isLoading}
          />
        </section>
        <AlertStream rows={alerts.rows} isLoading={alerts.isLoading} isError={alerts.isError} />
      </div>

      <CreatePatientDialog open={createOpen} onOpenChange={setCreateOpen} />
    </main>
  );
}
