import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreatePatientNoteInput, type PatientNote } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  patientId: string;
}

const NOTE_TIME_FMT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

async function fetchNotes(patientId: string): Promise<PatientNote[]> {
  const { data, error } = await supabase
    .from('patient_notes')
    .select('id, patient_id, author_caregiver_id, author_name, body, created_at')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PatientNote[];
}

type FormValues = { body: string };

export function PatientNotesSection({ patientId }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['patient-notes', patientId],
    queryFn: () => fetchNotes(patientId),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(CreatePatientNoteInput),
    defaultValues: { body: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues): Promise<PatientNote> => {
      if (!user) throw new Error('Not signed in');
      const authorName =
        (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Unknown';
      const { data, error } = await supabase
        .from('patient_notes')
        .insert({
          patient_id: patientId,
          body: values.body.trim(),
          author_caregiver_id: user.id,
          author_name: authorName,
        })
        .select('id, patient_id, author_caregiver_id, author_name, body, created_at')
        .single();
      if (error) throw error;
      return data as PatientNote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-notes', patientId] });
      form.reset({ body: '' });
      mutation.reset();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
        <CardDescription>Care notes left by you and other caregivers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <NotesList query={query} />

        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-2 border-t border-border/60 pt-6"
        >
          <Textarea
            placeholder="Add a note…"
            rows={3}
            aria-label="Note body"
            aria-invalid={form.formState.errors.body ? true : undefined}
            disabled={mutation.isPending}
            {...form.register('body')}
          />
          {form.formState.errors.body && (
            <p className="text-sm text-destructive">{form.formState.errors.body.message}</p>
          )}
          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Adding…' : 'Add note'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface NotesListProps {
  query: ReturnType<typeof useQuery<PatientNote[]>>;
}

function NotesList({ query }: NotesListProps) {
  if (query.isLoading) {
    return (
      <div className="space-y-3" data-testid="patient-notes-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">
          Couldn't load notes: {(query.error as Error).message || 'Unknown error'}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!query.data?.length) {
    return <p className="text-sm text-muted-foreground">No notes yet — add the first one below.</p>;
  }

  return (
    <ul className="space-y-4">
      {query.data.map((note) => (
        <li key={note.id} className="rounded-lg border border-border/60 bg-card/40 p-4">
          <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {note.author_name} · {NOTE_TIME_FMT.format(new Date(note.created_at))}
          </p>
        </li>
      ))}
    </ul>
  );
}
