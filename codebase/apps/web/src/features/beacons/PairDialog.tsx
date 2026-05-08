import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';
import { useUpsertBeacon } from './beaconQueries';

interface PairDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mac: string | null;
  patientId: string;
  /** May be null when the patient has no floor plan yet. Pairing still
   *  works — the beacon is unplaced until placement (slice 3). */
  floorPlanId: string | null;
}

const LABEL_MIN = 1;
const LABEL_MAX = 60;

export function PairDialog({ open, onOpenChange, mac, patientId, floorPlanId }: PairDialogProps) {
  const upsert = useUpsertBeacon(patientId);
  const forget = useDiscoveredBeaconsStore((s) => s.forget);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel('');
      setError(null);
    }
  }, [open, mac]);

  const trimmed = label.trim();
  const valid = trimmed.length >= LABEL_MIN && trimmed.length <= LABEL_MAX && mac != null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !mac) return;
    try {
      await upsert.mutateAsync({
        patient_id: patientId,
        floor_plan_id: floorPlanId,
        mac_address: mac,
        label: trimmed,
      });
      forget(patientId, mac);
      onOpenChange(false);
    } catch (err) {
      // PostgREST surfaces unique-violation as code 23505. Catch it
      // specifically — multiple caregivers can pair the same beacon to
      // their patient simultaneously and the second one hits this.
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        setError('A beacon with this MAC is already paired to this patient.');
      } else {
        setError((err as Error).message ?? 'Pairing failed.');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pair beacon</DialogTitle>
          <DialogDescription>
            Give this beacon a room name. You can place it on the floor plan after pairing.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            MAC: <span className="font-mono text-foreground">{mac ?? '—'}</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="beacon-label">Label</Label>
            <Input
              id="beacon-label"
              autoFocus
              value={label}
              maxLength={LABEL_MAX}
              onChange={(e) => {
                setLabel(e.target.value);
                setError(null);
              }}
              placeholder="e.g. Living room"
            />
          </div>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={upsert.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || upsert.isPending}>
              {upsert.isPending ? 'Pairing…' : 'Pair'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
