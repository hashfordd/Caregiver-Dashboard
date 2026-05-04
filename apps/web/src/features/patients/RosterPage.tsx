import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus, Users } from 'lucide-react';
import type { Patient } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
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

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  return Math.floor((Date.now() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function RosterPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const query = useQuery({ queryKey: ['patients', 'roster'], queryFn: fetchRoster });
  const { user } = useAuth();

  const firstName = user?.user_metadata?.full_name
    ? (user.user_metadata.full_name as string).split(/\s+/)[0]
    : null;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <section className="mb-8 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Patient roster</p>
          <h1 className="font-serif italic text-4xl text-foreground">
            {firstName ? `Welcome, ${firstName}.` : 'Welcome.'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {query.data?.length === 1
              ? 'One patient under your care.'
              : query.data?.length
                ? `${query.data.length} patients under your care.`
                : "Patients you're allocated to."}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New patient
        </Button>
      </section>

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
              <Plus className="h-4 w-4" />
              Create your first patient
            </Button>
          }
        />
      )}

      {query.isSuccess && query.data.length > 0 && (
        <ul className="grid gap-3" aria-label="Patient roster">
          {query.data.map((p) => {
            const age = ageFromDob(p.dob);
            return (
              <li key={p.id}>
                <Link
                  to={`/patients/${p.id}`}
                  className="group flex items-center gap-4 rounded-lg border border-border/60 bg-card px-5 py-4 text-card-foreground transition-all hover:border-accent hover:shadow-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div
                    aria-hidden
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-space-400 font-serif italic text-xl text-eggshell-500"
                  >
                    {initials(p.full_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <h2 className="truncate font-semibold text-foreground">{p.full_name}</h2>
                      {age != null && (
                        <span className="text-xs text-muted-foreground">age {age}</span>
                      )}
                    </div>
                    {p.notes && (
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {truncate(p.notes, 100)}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <CreatePatientDialog open={createOpen} onOpenChange={setCreateOpen} />
    </main>
  );
}
