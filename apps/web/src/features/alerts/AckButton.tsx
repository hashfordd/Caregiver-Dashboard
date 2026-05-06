import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import type { AlertRow } from '@alzcare/shared';

interface AckButtonProps {
  alert: AlertRow;
  /** Optional callback for parents that want to optimistically remove
   *  the row from a local list (e.g. the bell popover). The mutation
   *  also patches every React Query cache that holds the alert. */
  onAcked?: () => void;
}

/** Calls the public.acknowledge_alert RPC. Idempotent per the SQL
 *  contract — clicking twice converges. Optimistically updates the
 *  caches so the bell badge / per-patient feed flip immediately;
 *  rolls back if the RPC errors (anything other than the "already
 *  acked" silent path). */
export function AckButton({ alert, onAcked }: AckButtonProps) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('acknowledge_alert', {
        p_alert_id: alert.id,
      });
      if (error) throw error;
      return data as AlertRow;
    },
    onMutate: () => {
      const optimisticRow = {
        ...alert,
        acknowledged_at: new Date().toISOString(),
      };
      // Patch every cached list that holds this alert.
      qc.setQueriesData<AlertRow[]>({ queryKey: ['alerts'] }, (prev) =>
        prev?.map((r) => (r.id === alert.id ? optimisticRow : r)),
      );
      return { previous: alert };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueriesData<AlertRow[]>({ queryKey: ['alerts'] }, (prev) =>
        prev?.map((r) => (r.id === alert.id ? ctx.previous : r)),
      );
    },
    onSuccess: () => {
      onAcked?.();
    },
  });

  if (alert.acknowledged_at != null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5" /> Acknowledged
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Check className="mr-1 h-3.5 w-3.5" />
      )}
      Acknowledge
    </Button>
  );
}
