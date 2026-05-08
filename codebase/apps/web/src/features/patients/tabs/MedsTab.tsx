import { useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pill, Plus, X } from 'lucide-react';
import {
  CreateMedicationInput,
  LogAdministrationInput,
  MedicationAdminStatus,
  type Medication,
  type MedicationAdministration,
  type MedicationAdminStatus as MedicationAdminStatusEnum,
} from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCurrentCaregiver } from '@/features/provider/providerQueries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
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

const MEDS_KEY = (patientId: string) => ['patients', 'medications', patientId] as const;
const ADMINS_KEY = (patientId: string) =>
  ['patients', 'medication-administrations', patientId] as const;

export function MedsTab({ patientId }: Props) {
  const me = useCurrentCaregiver();
  const isAdmin = me.data?.provider_role === 'admin';
  const [createOpen, setCreateOpen] = useState(false);

  const meds = useQuery({
    queryKey: MEDS_KEY(patientId),
    queryFn: async (): Promise<Medication[]> => {
      const { data, error } = await supabase
        .from('medications')
        .select(
          'id, patient_id, name, dose, route, schedule, prn, active, notes, created_at, updated_at',
        )
        .eq('patient_id', patientId)
        .order('active', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Medication[];
    },
  });

  const admins = useQuery({
    queryKey: ADMINS_KEY(patientId),
    queryFn: async (): Promise<MedicationAdministration[]> => {
      // Two-stage: select medication ids for this patient, then fetch
      // administrations. PostgREST embeds also work but the read RLS is
      // simplest expressed without the join.
      const { data: medRows } = await supabase
        .from('medications')
        .select('id')
        .eq('patient_id', patientId);
      const ids = (medRows ?? []).map((r: { id: string }) => r.id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('medication_administrations')
        .select(
          'id, medication_id, scheduled_for, administered_at, administered_by, status, notes, created_at',
        )
        .in('medication_id', ids)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as MedicationAdministration[];
    },
    enabled: !!meds.data,
  });

  const adminsByMed = useMemo(() => {
    const map = new Map<string, MedicationAdministration[]>();
    for (const a of admins.data ?? []) {
      const list = map.get(a.medication_id) ?? [];
      list.push(a);
      map.set(a.medication_id, list);
    }
    return map;
  }, [admins.data]);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Medications</h2>
          <p className="text-xs text-muted-foreground">
            {isAdmin
              ? 'You can edit the prescription list. Allocated caregivers can log administrations.'
              : 'Log administrations as you give them. Only tenant admins can edit the prescription list.'}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Add medication
          </Button>
        )}
      </header>

      {meds.isLoading && <Skeleton className="h-32 w-full" />}

      {meds.isSuccess && meds.data.length === 0 && (
        <EmptyState
          icon={<Pill className="h-10 w-10" />}
          title="No medications recorded"
          description={
            isAdmin
              ? 'Add a medication to start the administration log.'
              : 'A tenant admin needs to set up this patient’s medications first.'
          }
        />
      )}

      <ul className="space-y-3">
        {(meds.data ?? []).map((med) => (
          <MedicationCard
            key={med.id}
            patientId={patientId}
            medication={med}
            administrations={adminsByMed.get(med.id) ?? []}
            isAdmin={isAdmin}
          />
        ))}
      </ul>

      <CreateMedicationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        patientId={patientId}
      />
    </section>
  );
}

function MedicationCard({
  patientId,
  medication,
  administrations,
  isAdmin,
}: {
  patientId: string;
  medication: Medication;
  administrations: MedicationAdministration[];
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [logOpen, setLogOpen] = useState(false);

  const deactivate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('medications')
        .update({ active: false })
        .eq('id', medication.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEDS_KEY(patientId) });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'situation-overview'] });
    },
  });

  const scheduleLabel = (() => {
    if (medication.prn) return 'PRN — as needed';
    const times = medication.schedule?.times;
    if (!times || times.length === 0) return 'No schedule set';
    return times.join(', ');
  })();

  const lastAdmin = administrations[0] ?? null;

  return (
    <li>
      <Card className={cn(!medication.active && 'opacity-60')}>
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-base">
              {medication.name}
              {!medication.active && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  Inactive
                </span>
              )}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[medication.dose, medication.route, scheduleLabel].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {medication.active && (
              <Button size="sm" onClick={() => setLogOpen(true)}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Log dose
              </Button>
            )}
            {isAdmin && medication.active && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deactivate.mutate()}
                disabled={deactivate.isPending}
              >
                <X className="h-3.5 w-3.5" />
                Deactivate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {medication.notes && (
            <p className="mb-3 text-xs italic text-muted-foreground">{medication.notes}</p>
          )}
          {administrations.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No doses logged yet.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Recent doses
              </p>
              <ul className="divide-y divide-border/40 text-xs">
                {administrations.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-1.5">
                    <span className="capitalize">{a.status}</span>
                    <span className="text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
              {lastAdmin && (
                <p className="pt-1 text-[10px] text-muted-foreground">
                  Last logged: {new Date(lastAdmin.created_at).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <LogAdministrationDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        medicationId={medication.id}
        medicationName={medication.name}
        patientId={patientId}
        caregiverId={user?.id ?? null}
      />
    </li>
  );
}

type LogValues = {
  status: MedicationAdminStatusEnum;
  notes: string;
};

function LogAdministrationDialog({
  open,
  onOpenChange,
  medicationId,
  medicationName,
  patientId,
  caregiverId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicationId: string;
  medicationName: string;
  patientId: string;
  caregiverId: string | null;
}) {
  const queryClient = useQueryClient();
  const form = useForm<LogValues>({
    resolver: zodResolver(LogAdministrationInput),
    defaultValues: { status: 'given', notes: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: LogValues) => {
      if (!caregiverId) throw new Error('Not signed in');
      const { error } = await supabase.from('medication_administrations').insert({
        medication_id: medicationId,
        scheduled_for: null,
        administered_at: values.status === 'given' ? new Date().toISOString() : null,
        administered_by: caregiverId,
        status: values.status,
        notes: values.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMINS_KEY(patientId) });
      onOpenChange(false);
      form.reset();
      mutation.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log administration · {medicationName}</DialogTitle>
          <DialogDescription>
            Record what happened with this dose. Refused / skipped doses still belong in the log so
            the audit trail stays complete.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="admin-status">Outcome</Label>
            <Controller
              name="status"
              control={form.control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="admin-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MedicationAdminStatus.options.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="capitalize">{s}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-notes">Notes (optional)</Label>
            <Textarea
              id="admin-notes"
              rows={3}
              placeholder="Refusal reason, observed reaction, escalation taken."
              {...form.register('notes')}
            />
          </div>

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
              {mutation.isPending ? 'Logging…' : 'Log dose'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type CreateValues = {
  name: string;
  dose: string;
  route: string;
  prn: boolean;
  schedule_times: string[];
  notes: string;
};

function CreateMedicationDialog({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const form = useForm<CreateValues>({
    resolver: zodResolver(CreateMedicationInput),
    defaultValues: {
      name: '',
      dose: '',
      route: '',
      prn: false,
      schedule_times: [],
      notes: '',
    },
  });
  const [timeDraft, setTimeDraft] = useState('');

  const mutation = useMutation({
    mutationFn: async (values: CreateValues) => {
      const schedule = values.prn ? null : { times: values.schedule_times, tz: 'Australia/Sydney' };
      const { error } = await supabase.from('medications').insert({
        patient_id: patientId,
        name: values.name,
        dose: values.dose || null,
        route: values.route || null,
        schedule,
        prn: values.prn,
        active: true,
        notes: values.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEDS_KEY(patientId) });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'situation-overview'] });
      onOpenChange(false);
      form.reset();
      mutation.reset();
      setTimeDraft('');
    },
  });

  const times = form.watch('schedule_times');
  const prn = form.watch('prn');

  function addTime() {
    if (!/^\d{2}:\d{2}$/.test(timeDraft)) return;
    if (times.includes(timeDraft)) {
      setTimeDraft('');
      return;
    }
    if (times.length >= 8) return;
    form.setValue('schedule_times', [...times, timeDraft].sort());
    setTimeDraft('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add medication</DialogTitle>
          <DialogDescription>
            V1 schedule shape: a list of HH:MM slots in {`Australia/Sydney`}. PRN means as-needed;
            the schedule list is ignored.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="med-name">Name</Label>
            <Input id="med-name" {...form.register('name')} placeholder="Donepezil" />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="med-dose">Dose</Label>
              <Input id="med-dose" {...form.register('dose')} placeholder="5 mg" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="med-route">Route</Label>
              <Input id="med-route" {...form.register('route')} placeholder="oral" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('prn')} className="h-4 w-4" />
            <span>PRN (as needed) — no fixed schedule</span>
          </label>

          {!prn && (
            <div className="space-y-1.5">
              <Label htmlFor="med-time">Scheduled times</Label>
              <div className="flex gap-2">
                <Input
                  id="med-time"
                  type="time"
                  value={timeDraft}
                  onChange={(e) => setTimeDraft(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={addTime}>
                  Add slot
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {times.length === 0 && (
                  <p className="text-xs italic text-muted-foreground">No slots set.</p>
                )}
                {times.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                  >
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove ${t}`}
                      onClick={() =>
                        form.setValue(
                          'schedule_times',
                          times.filter((x) => x !== t),
                        )
                      }
                      className="rounded-full p-0.5 hover:bg-muted-foreground/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="med-notes">Notes (optional)</Label>
            <Textarea id="med-notes" rows={3} {...form.register('notes')} />
          </div>

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
              {mutation.isPending ? 'Adding…' : 'Add medication'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
