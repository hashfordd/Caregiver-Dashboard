import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import type { Patient } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { CreatePatientDialog } from '@/features/patients/CreatePatientDialog';

async function fetchRoster(): Promise<Patient[]> {
  const { data, error } = await supabase
    .from('patients')
    .select('id, full_name, dob, notes, primary_caregiver_id, created_at')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Patient[];
}

function ageFromDob(dob: string | null): string {
  if (!dob) return '';
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return '';
  const years = Math.floor((Date.now() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  return ` · age ${years}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function RosterPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const query = useQuery({ queryKey: ['patients', 'roster'], queryFn: fetchRoster });

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif italic text-3xl text-foreground">Patient roster</h1>
            <p className="text-sm text-muted-foreground">Patients you're allocated to.</p>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/profile" className="text-sm underline-offset-4 hover:underline">
              Profile
            </Link>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New patient
            </Button>
          </div>
        </header>

        {query.isLoading && (
          <div className="grid gap-3" data-testid="roster-loading">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )}

        {query.isError && (
          <Card>
            <CardHeader>
              <CardTitle>Couldn't load the roster</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-destructive">
                {(query.error as Error).message || 'Unknown error'}
              </p>
              <Button onClick={() => query.refetch()}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {query.isSuccess && query.data.length === 0 && (
          <EmptyState
            icon={<Users className="h-10 w-10" />}
            title="No patients allocated"
            description="Create your first patient to start monitoring their vitals and movement."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first patient
              </Button>
            }
          />
        )}

        {query.isSuccess && query.data.length > 0 && (
          <ul className="grid gap-3" aria-label="Patient roster">
            {query.data.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/patients/${p.id}`}
                  className="block rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="p-4">
                    <h2 className="font-semibold">
                      {p.full_name}
                      <span className="text-sm font-normal text-muted-foreground">
                        {ageFromDob(p.dob)}
                      </span>
                    </h2>
                    {p.notes && (
                      <p className="mt-1 text-sm text-muted-foreground">{truncate(p.notes, 80)}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <CreatePatientDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    </main>
  );
}
