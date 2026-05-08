import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

interface UnpairButtonProps {
  deviceId: string;
  patientId: string;
}

export function UnpairButton({ deviceId, patientId }: UnpairButtonProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('devices')
        .update({ paired_patient_id: null })
        .eq('id', deviceId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices', patientId] }),
  });

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? 'Unpairing…' : 'Unpair'}
    </Button>
  );
}
