import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { CarePlanInput, DementiaStage, WanderingRisk, type Patient } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

type FormValues = {
  dementia_stage: DementiaStage;
  wandering_risk: WanderingRisk;
  known_triggers: string[];
  care_plan_summary: string;
};

const PATIENT_DETAIL_KEY = (id: string) => ['patients', 'detail', id] as const;

const STAGE_OPTIONS: Array<{ value: DementiaStage; label: string }> = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'early', label: 'Early' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'advanced', label: 'Advanced' },
];

const RISK_OPTIONS: Array<{ value: WanderingRisk; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function CarePlanTab({ patientId }: Props) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: PATIENT_DETAIL_KEY(patientId),
    queryFn: async (): Promise<Patient | null> => {
      // Cached by PatientDetailPage's queryKey — this read piggy-backs.
      const { data, error } = await supabase
        .from('patients')
        .select(
          'id, full_name, dob, description, care_provider_id, created_at, ' +
            'dementia_stage, wandering_risk, known_triggers, care_plan_summary, preferences',
        )
        .eq('id', patientId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Patient) ?? null;
    },
  });

  const patient = query.data ?? null;

  const form = useForm<FormValues>({
    resolver: zodResolver(CarePlanInput),
    defaultValues: {
      dementia_stage: 'unknown',
      wandering_risk: 'low',
      known_triggers: [],
      care_plan_summary: '',
    },
  });

  // Hydrate the form when the patient row arrives. Keep the form
  // ownership pattern from EditPatientDialog: explicit reset on prop
  // change rather than form-level keys.
  useEffect(() => {
    if (!patient) return;
    form.reset({
      dementia_stage: patient.dementia_stage,
      wandering_risk: patient.wandering_risk,
      known_triggers: patient.known_triggers,
      care_plan_summary: patient.care_plan_summary ?? '',
    });
  }, [patient, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues): Promise<Patient> => {
      const { data, error } = await supabase
        .from('patients')
        .update({
          dementia_stage: values.dementia_stage,
          wandering_risk: values.wandering_risk,
          known_triggers: values.known_triggers,
          care_plan_summary: values.care_plan_summary || null,
        })
        .eq('id', patientId)
        .select(
          'id, full_name, dob, description, care_provider_id, created_at, ' +
            'dementia_stage, wandering_risk, known_triggers, care_plan_summary, preferences',
        )
        .single();
      if (error) throw error;
      return data as unknown as Patient;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PATIENT_DETAIL_KEY(patientId), data);
      // Risk badge reads from get_situation_overview, so the dashboard
      // grid needs to repoll for the new band.
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'situation-overview'] });
    },
  });

  if (query.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError || !patient) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Couldn't load this patient's care plan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {(query.error as Error)?.message ?? 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const triggers = form.watch('known_triggers');

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="grid gap-6 md:grid-cols-2"
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinical context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="dementia-stage">Dementia stage</Label>
            <Controller
              name="dementia_stage"
              control={form.control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="dementia-stage">
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wandering-risk">Wandering risk</Label>
            <Controller
              name="wandering_risk"
              control={form.control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="wandering-risk">
                    <SelectValue placeholder="Select risk band" />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">
              Drives the badge on the situation room grid + this patient's header.
            </p>
          </div>

          <Controller
            name="known_triggers"
            control={form.control}
            render={({ field }) => (
              <TriggersField
                value={triggers}
                onAdd={(t) => field.onChange([...field.value, t])}
                onRemove={(idx) => {
                  const next = [...field.value];
                  next.splice(idx, 1);
                  field.onChange(next);
                }}
              />
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shift handover</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="care-plan-summary">Care plan summary</Label>
            <Textarea
              id="care-plan-summary"
              {...form.register('care_plan_summary')}
              rows={10}
              placeholder="Daily routines, do-not-do, recent changes, anything the next shift needs to know."
              className="resize-y"
            />
            <p className="text-xs text-muted-foreground">
              Visible to every caregiver allocated to this patient.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <p
              className={cn(
                'text-xs',
                mutation.isError
                  ? 'text-destructive'
                  : mutation.isSuccess
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground',
              )}
            >
              {mutation.isError
                ? (mutation.error as Error).message
                : mutation.isSuccess
                  ? 'Saved.'
                  : ' '}
            </p>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function TriggersField({
  value,
  onAdd,
  onRemove,
}: {
  value: string[];
  onAdd: (trigger: string) => void;
  onRemove: (index: number) => void;
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.length >= 20) return;
    if (value.includes(trimmed)) {
      setDraft('');
      return;
    }
    onAdd(trimmed);
    setDraft('');
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="known-triggers">Known triggers</Label>
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && (
          <p className="text-xs italic text-muted-foreground">No triggers logged yet.</p>
        )}
        {value.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
          >
            {t}
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove trigger ${t}`}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          id="known-triggers"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="e.g. afternoon agitation"
          maxLength={80}
        />
        <Button type="button" variant="outline" onClick={commit}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Up to 20 triggers, 80 chars each.</p>
    </div>
  );
}
