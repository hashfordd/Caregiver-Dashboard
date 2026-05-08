import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAllocatedAlerts } from '@/features/alerts/useAllocatedAlerts';
import { CreatePatientDialog } from '@/features/patients/CreatePatientDialog';
import { ActivityFeed } from './ActivityFeed';
import { AlertStream } from './AlertStream';
import { LiveGrid } from './LiveGrid';
import { PatientSideRail } from './PatientSideRail';
import { SituationHeader } from './SituationHeader';
import { useSituationOverview } from './useSituationOverview';

export function SituationRoomPage() {
  const { user } = useAuth();
  const patientsQuery = useSituationOverview();
  const alerts = useAllocatedAlerts();
  const [createOpen, setCreateOpen] = useState(false);

  // Phase II.D: ?focus=<patient-id> drives the side-rail. Bookmarkable
  // and survives history navigation, so a caregiver can return to
  // exactly the patient they were watching.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedId = searchParams.get('focus');

  const setFocus = useCallback(
    (patientId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patientId) next.set('focus', patientId);
          else next.delete('focus');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const firstName = useMemo(() => {
    const fullName = user?.user_metadata?.full_name as string | undefined;
    return fullName ? fullName.split(/\s+/)[0] : null;
  }, [user]);

  const patients = patientsQuery.data ?? [];

  const unackedAlerts = useMemo(
    () => alerts.rows.filter((r) => r.acknowledged_at == null),
    [alerts.rows],
  );

  // Resolve the focused situation row. If the id is in the URL but the
  // patient has fallen out of the caller's allocation set, we silently
  // drop the rail rather than render an empty shell.
  const focusedSituation = useMemo(
    () => (focusedId ? (patients.find((p) => p.patient_id === focusedId) ?? null) : null),
    [patients, focusedId],
  );

  const focusedAlerts = useMemo(
    () =>
      focusedId
        ? unackedAlerts
            .filter((a) => a.patient_id === focusedId)
            .sort((a, b) => (a.fired_at < b.fired_at ? 1 : -1))
        : [],
    [unackedAlerts, focusedId],
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
          patients={patients}
          unackedAlerts={unackedAlerts}
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
            selectedPatientId={focusedSituation?.patient_id ?? null}
            onSelect={(id) => setFocus(id === focusedSituation?.patient_id ? null : id)}
          />
        </section>
        <div className="flex flex-col gap-6">
          {focusedSituation ? (
            <PatientSideRail
              situation={focusedSituation}
              unackedAlerts={focusedAlerts}
              onClose={() => setFocus(null)}
            />
          ) : (
            <>
              <AlertStream
                rows={alerts.rows}
                isLoading={alerts.isLoading}
                isError={alerts.isError}
              />
              <ActivityFeed />
            </>
          )}
        </div>
      </div>

      <CreatePatientDialog open={createOpen} onOpenChange={setCreateOpen} />
    </main>
  );
}
