import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash } from 'lucide-react';
import { CreatePatientNoteInput, UpdatePatientNoteInput, type PatientNote } from '@alzcare/shared';
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

// PostgREST embed: pull the author's display name from the caregivers
// table via the FK (Phase C item 35 — closed the user_metadata
// spoofing surface). The peer-read RLS policy added in Phase B's
// caregivers_self_or_peer_read makes this resolve for any teammate in
// the same provider.
const NOTE_COLUMNS =
  'id, patient_id, author_caregiver_id, body, created_at, author:caregivers!author_caregiver_id (full_name)';

async function fetchNotes(patientId: string): Promise<PatientNote[]> {
  const { data, error } = await supabase
    .from('patient_notes')
    .select(NOTE_COLUMNS)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PatientNote[];
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

  const insertMutation = useMutation({
    mutationFn: async (values: FormValues): Promise<PatientNote> => {
      if (!user) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('patient_notes')
        .insert({
          patient_id: patientId,
          body: values.body.trim(),
          author_caregiver_id: user.id,
        })
        .select(NOTE_COLUMNS)
        .single();
      if (error) throw error;
      return data as unknown as PatientNote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-notes', patientId] });
      form.reset({ body: '' });
      insertMutation.reset();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
        <CardDescription>Care notes left by you and other caregivers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <NotesList query={query} patientId={patientId} currentUserId={user?.id ?? null} />

        <form
          onSubmit={form.handleSubmit((values) => insertMutation.mutate(values))}
          className="space-y-2 border-t border-border/60 pt-6"
        >
          <Textarea
            placeholder="Add a note…"
            rows={3}
            aria-label="Note body"
            aria-invalid={form.formState.errors.body ? true : undefined}
            disabled={insertMutation.isPending}
            {...form.register('body')}
          />
          {form.formState.errors.body && (
            <p className="text-sm text-destructive">{form.formState.errors.body.message}</p>
          )}
          {insertMutation.isError && (
            <p className="text-sm text-destructive">{(insertMutation.error as Error).message}</p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={insertMutation.isPending}>
              {insertMutation.isPending ? 'Adding…' : 'Add note'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface NotesListProps {
  query: ReturnType<typeof useQuery<PatientNote[]>>;
  patientId: string;
  currentUserId: string | null;
}

function NotesList({ query, patientId, currentUserId }: NotesListProps) {
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
        <NoteRow
          key={note.id}
          note={note}
          patientId={patientId}
          isOwn={!!currentUserId && note.author_caregiver_id === currentUserId}
        />
      ))}
    </ul>
  );
}

interface NoteRowProps {
  note: PatientNote;
  patientId: string;
  isOwn: boolean;
}

function NoteRow({ note, patientId, isOwn }: NoteRowProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const editForm = useForm<FormValues>({
    resolver: zodResolver(UpdatePatientNoteInput),
    defaultValues: { body: note.body },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues): Promise<PatientNote> => {
      const { data, error } = await supabase
        .from('patient_notes')
        .update({ body: values.body.trim() })
        .eq('id', note.id)
        .select(NOTE_COLUMNS)
        .single();
      if (error) throw error;
      return data as unknown as PatientNote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-notes', patientId] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('patient_notes').delete().eq('id', note.id);
      if (error) throw error;
    },
    onMutate: async () => {
      // Optimistic remove from the cached list — RLS author-only delete
      // will succeed for own notes; we roll back on error below.
      await queryClient.cancelQueries({ queryKey: ['patient-notes', patientId] });
      const previous = queryClient.getQueryData<PatientNote[]>(['patient-notes', patientId]);
      queryClient.setQueryData<PatientNote[]>(['patient-notes', patientId], (rows) =>
        rows ? rows.filter((r) => r.id !== note.id) : rows,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['patient-notes', patientId], ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-notes', patientId] });
    },
  });

  const authorName = note.author?.full_name ?? 'Unknown';

  return (
    <li className="rounded-lg border border-border/60 bg-card/40 p-4">
      {editing ? (
        <form
          onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}
          className="space-y-2"
        >
          <Textarea
            rows={3}
            aria-label="Edit note body"
            aria-invalid={editForm.formState.errors.body ? true : undefined}
            disabled={updateMutation.isPending}
            {...editForm.register('body')}
          />
          {editForm.formState.errors.body && (
            <p className="text-sm text-destructive">{editForm.formState.errors.body.message}</p>
          )}
          {updateMutation.isError && (
            <p className="text-sm text-destructive">{(updateMutation.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                editForm.reset({ body: note.body });
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {authorName} · {NOTE_TIME_FMT.format(new Date(note.created_at))}
            </p>
            {isOwn && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Edit note"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {confirmingDelete ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate()}
                    >
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="Delete note"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
          {deleteMutation.isError && (
            <p className="mt-2 text-xs text-destructive">
              {(deleteMutation.error as Error).message}
            </p>
          )}
        </>
      )}
    </li>
  );
}
