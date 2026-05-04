import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { Device } from '@alzcare/shared';
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

const PairFormSchema = z.object({
  mac_address: z
    .string()
    .regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i, 'expected MAC like aa:bb:cc:dd:ee:ff'),
  label: z.string().max(60).optional(),
});
type PairFormValues = z.infer<typeof PairFormSchema>;

interface PairDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}

export function PairDeviceDialog({ open, onOpenChange, patientId }: PairDeviceDialogProps) {
  const queryClient = useQueryClient();
  const form = useForm<PairFormValues>({
    resolver: zodResolver(PairFormSchema),
    defaultValues: { mac_address: '', label: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: PairFormValues): Promise<Device> => {
      const { data, error } = await supabase.rpc('pair_device', {
        p_mac_address: values.mac_address.toLowerCase(),
        p_patient_id: patientId,
        p_label: values.label || null,
      });
      if (error) throw error;
      return data as Device;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', patientId] });
      onOpenChange(false);
      form.reset();
      mutation.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pair device</DialogTitle>
          <DialogDescription>
            Enter the wearable's MAC address. It pairs to the patient currently in view.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="mac_address">MAC address</Label>
            <Input
              id="mac_address"
              autoFocus
              placeholder="aa:bb:cc:dd:ee:ff"
              autoComplete="off"
              {...form.register('mac_address')}
              aria-invalid={form.formState.errors.mac_address ? true : undefined}
            />
            {form.formState.errors.mac_address && (
              <p className="text-sm text-destructive">
                {form.formState.errors.mac_address.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="label">Label (optional)</Label>
            <Input id="label" placeholder="wrist left" {...form.register('label')} />
          </div>
          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Pairing…' : 'Pair'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
