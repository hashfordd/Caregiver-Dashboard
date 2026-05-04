import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreatePatientInput, type Patient } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
}

type FormValues = {
  full_name: string;
  dob: string;
  notes: string;
};

export function CreatePatientDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(CreatePatientInput),
    defaultValues: { full_name: '', dob: '', notes: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues): Promise<Patient> => {
      const { data, error } = await supabase.rpc('create_patient_with_allocation', {
        p_full_name: values.full_name,
        p_dob: values.dob || null,
        p_notes: values.notes || null,
      });
      if (error) throw error;
      return data as Patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients', 'roster'] });
      onOpenChange(false);
      form.reset();
      mutation.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New patient</DialogTitle>
          <DialogDescription>
            Add a patient to your roster. You'll be allocated automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input
              id="full_name"
              autoFocus
              {...form.register('full_name')}
              aria-invalid={form.formState.errors.full_name ? true : undefined}
            />
            {form.formState.errors.full_name && (
              <p className="text-sm text-destructive">{form.formState.errors.full_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="dob">Date of birth (optional)</Label>
            <Input id="dob" type="date" {...form.register('dob')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" {...form.register('notes')} />
          </div>
          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create patient'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
