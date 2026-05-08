import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UpdatePatientInput, type Patient } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
}

type FormValues = {
  full_name: string;
  dob: string;
  description: string;
};

function toFormValues(patient: Patient): FormValues {
  return {
    full_name: patient.full_name,
    dob: patient.dob ?? '',
    description: patient.description ?? '',
  };
}

export function EditPatientDialog({ open, onOpenChange, patient }: Props) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(UpdatePatientInput),
    defaultValues: toFormValues(patient),
  });

  // Reset whenever the dialog opens for a (potentially) different patient so
  // stale field state from a previous edit doesn't leak in.
  useEffect(() => {
    if (open) form.reset(toFormValues(patient));
  }, [open, patient, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues): Promise<Patient> => {
      const { data, error } = await supabase
        .from('patients')
        .update({
          full_name: values.full_name,
          dob: values.dob || null,
          description: values.description || null,
        })
        .eq('id', patient.id)
        .select('id, full_name, dob, description, care_provider_id, created_at')
        .single();
      if (error) throw error;
      return data as Patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients', 'roster'] });
      queryClient.invalidateQueries({ queryKey: ['patients', 'detail', patient.id] });
      onOpenChange(false);
      mutation.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit patient</DialogTitle>
          <DialogDescription>Update this patient's profile details.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="edit_full_name">Full name</Label>
            <Input
              id="edit_full_name"
              autoFocus
              {...form.register('full_name')}
              aria-invalid={form.formState.errors.full_name ? true : undefined}
            />
            {form.formState.errors.full_name && (
              <p className="text-sm text-destructive">{form.formState.errors.full_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_dob">Date of birth (optional)</Label>
            <Input id="edit_dob" type="date" {...form.register('dob')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_description">Description (optional)</Label>
            <Textarea id="edit_description" rows={4} {...form.register('description')} />
          </div>
          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
