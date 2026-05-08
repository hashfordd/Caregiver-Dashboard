import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Patient } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PatientHeader } from './PatientHeader';
import { PatientStreamProvider } from './PatientStreamContext';
import { PatientTabs } from './PatientTabs';

// Phase II.B: care plan + risk-profile columns are part of the Patient
// shape now, so every Patient-shaped fetch must include them or the
// CarePlanTab + risk badge fall back to defaults.
const PATIENT_COLUMNS =
  'id, full_name, dob, description, care_provider_id, created_at, ' +
  'dementia_stage, wandering_risk, known_triggers, care_plan_summary, preferences';

async function fetchPatient(id: string): Promise<Patient | null> {
  const { data, error } = await supabase
    .from('patients')
    .select(PATIENT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Patient) ?? null;
}

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['patients', 'detail', id],
    queryFn: () => fetchPatient(id!),
    enabled: !!id,
  });

  if (!id) return <NotFound />;

  if (query.isLoading) {
    return (
      <main className="mx-auto max-w-7xl space-y-4 px-6 py-10">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load this patient</CardTitle>
            <CardDescription>{(query.error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (!query.data) return <NotFound />;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <PatientStreamProvider patientId={id}>
        <PatientHeader patient={query.data} />
        <PatientTabs patientId={id} />
      </PatientStreamProvider>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Patient not found</CardTitle>
          <CardDescription>This patient doesn't exist or isn't allocated to you.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/patients" className="text-sm underline-offset-4 hover:underline">
            ← Back to roster
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
