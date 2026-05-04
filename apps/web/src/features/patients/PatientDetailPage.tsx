import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Patient } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PatientHeader } from './PatientHeader';
import { PatientStreamProvider } from './PatientStreamContext';
import { PatientTabs } from './PatientTabs';

async function fetchPatient(id: string): Promise<Patient | null> {
  const { data, error } = await supabase
    .from('patients')
    .select('id, full_name, dob, notes, primary_caregiver_id, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Patient) ?? null;
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
      <main className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-5xl">
          <Card>
            <CardHeader>
              <CardTitle>Couldn't load this patient</CardTitle>
              <CardDescription>{(query.error as Error).message}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  if (!query.data) return <NotFound />;

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl">
        <PatientStreamProvider patientId={id}>
          <PatientHeader patient={query.data} />
          <PatientTabs />
        </PatientStreamProvider>
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-md">
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
      </div>
    </main>
  );
}
