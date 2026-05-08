import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Plus } from 'lucide-react';
import {
  IncidentType,
  LogIncidentInput,
  type Incident,
  type IncidentType as IncidentTypeEnum,
} from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface Props {
  patientId: string;
}

const KEY = (patientId: string) => ['patients', 'incidents', patientId] as const;

const TYPE_LABEL: Record<IncidentTypeEnum, string> = {
  fall: 'Fall',
  agitation: 'Agitation',
  refusal: 'Refusal',
  wander: 'Wander',
  medication_event: 'Medication event',
  other: 'Other',
};

export function IncidentsTab({ patientId }: Props) {
  const [logOpen, setLogOpen] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: KEY(patientId),
    queryFn: async (): Promise<Incident[]> => {
      const { data, error } = await supabase
        .from('incidents')
        .select(
          'id, patient_id, logged_by, occurred_at, type, severity, description, ' +
            'follow_up_required, resolved_at, created_at, updated_at, ' +
            'author:caregivers!incidents_logged_by_fkey(full_name)',
        )
        .eq('patient_id', patientId)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Incident[];
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('incidents')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY(patientId) });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'situation-overview'] });
    },
  });

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Incident log</h2>
          <p className="text-xs text-muted-foreground">
            Caregiver-recorded events (falls, agitation, refusals, wanders) — distinct from
            rule-fired alerts.
          </p>
        </div>
        <Button onClick={() => setLogOpen(true)}>
          <Plus className="h-4 w-4" />
          Log incident
        </Button>
      </header>

      {query.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {query.isError && (
        <p className="text-sm text-destructive">{(query.error as Error).message}</p>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <EmptyState
          icon={<AlertTriangle className="h-10 w-10" />}
          title="No incidents logged"
          description="Use Log incident to record a fall, agitation, refusal, wander, or any other clinically relevant event."
        />
      )}

      {query.isSuccess && query.data.length > 0 && (
        <ul className="space-y-2">
          {query.data.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              onResolve={() => resolveMutation.mutate(incident.id)}
              resolving={resolveMutation.isPending && resolveMutation.variables === incident.id}
            />
          ))}
        </ul>
      )}

      <LogIncidentDialog open={logOpen} onOpenChange={setLogOpen} patientId={patientId} />
    </section>
  );
}

function IncidentCard({
  incident,
  onResolve,
  resolving,
}: {
  incident: Incident;
  onResolve: () => void;
  resolving: boolean;
}) {
  const sevTone =
    incident.severity === 3
      ? 'border-red-500/40 bg-red-500/5'
      : incident.severity === 2
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-border bg-card';
  const sevLabel =
    incident.severity === 3 ? 'Severe' : incident.severity === 2 ? 'Moderate' : 'Mild';
  const author = incident.author?.full_name ?? 'Unknown caregiver';
  return (
    <li>
      <Card className={cn('border', sevTone, incident.resolved_at && 'opacity-70')}>
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide">
                {TYPE_LABEL[incident.type]}
              </span>
              <span className="text-xs text-muted-foreground">{sevLabel}</span>
              {incident.follow_up_required && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                  Follow-up required
                </span>
              )}
              {incident.resolved_at && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                  Resolved
                </span>
              )}
            </div>
            <p className="text-sm text-foreground">{incident.description}</p>
            <p className="text-[11px] text-muted-foreground">
              <Clock className="mr-1 inline h-3 w-3" />
              {new Date(incident.occurred_at).toLocaleString()} · {author}
            </p>
          </div>
          {!incident.resolved_at && (
            <Button
              variant="outline"
              size="sm"
              onClick={onResolve}
              disabled={resolving}
              className="self-start"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {resolving ? 'Resolving…' : 'Mark resolved'}
            </Button>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

type LogFormValues = {
  type: IncidentTypeEnum;
  severity: 1 | 2 | 3;
  description: string;
  follow_up_required: boolean;
};

function LogIncidentDialog({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const form = useForm<LogFormValues>({
    resolver: zodResolver(LogIncidentInput),
    defaultValues: {
      type: 'fall',
      severity: 1,
      description: '',
      follow_up_required: false,
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: LogFormValues) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase.from('incidents').insert({
        patient_id: patientId,
        logged_by: user.id,
        occurred_at: new Date().toISOString(),
        type: values.type,
        severity: values.severity,
        description: values.description,
        follow_up_required: values.follow_up_required,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY(patientId) });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'situation-overview'] });
      onOpenChange(false);
      form.reset();
      mutation.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log incident</DialogTitle>
          <DialogDescription>
            Record a clinically relevant event. Distinct from rule-fired alerts — this is the
            human-authored narrative.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
          noValidate
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="incident-type">Type</Label>
              <Controller
                name="type"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="incident-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IncidentType.options.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="incident-severity">Severity</Label>
              <Controller
                name="severity"
                control={form.control}
                render={({ field }) => (
                  <Select
                    value={String(field.value)}
                    onValueChange={(v) => field.onChange(Number(v) as 1 | 2 | 3)}
                  >
                    <SelectTrigger id="incident-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 · Mild</SelectItem>
                      <SelectItem value="2">2 · Moderate</SelectItem>
                      <SelectItem value="3">3 · Severe</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="incident-description">Description</Label>
            <Textarea
              id="incident-description"
              rows={5}
              placeholder="What happened, when, what you did, how the patient responded."
              {...form.register('description')}
            />
            {form.formState.errors.description && (
              <p className="text-xs text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('follow_up_required')} className="h-4 w-4" />
            <span>Follow-up required</span>
          </label>

          {mutation.isError && (
            <p className="text-xs text-destructive">{(mutation.error as Error).message}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Logging…' : 'Log incident'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
