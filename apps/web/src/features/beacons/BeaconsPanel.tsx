import { Bluetooth, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useBeacons, useDeleteBeacon } from './beaconQueries';
import { isPlaced, type BeaconRow } from './types';

interface BeaconsPanelProps {
  patientId: string;
}

export function BeaconsPanel({ patientId }: BeaconsPanelProps) {
  const beaconsQuery = useBeacons(patientId);
  const deleteBeacon = useDeleteBeacon(patientId);

  if (beaconsQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (beaconsQuery.isError) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-destructive">
            Couldn't load beacons: {(beaconsQuery.error as Error).message}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => beaconsQuery.refetch()}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const beacons = beaconsQuery.data ?? [];

  if (beacons.length === 0) {
    return (
      <EmptyState
        icon={<Bluetooth className="h-10 w-10" />}
        title="No beacons paired yet"
        description="Beacon discovery and pairing arrives in the next slice. For now, paired beacons appear here once a row exists in the beacons table."
      />
    );
  }

  return (
    <div className="space-y-2">
      {beacons.map((b) => (
        <BeaconCard
          key={b.id}
          beacon={b}
          deleting={deleteBeacon.isPending && deleteBeacon.variables === b.id}
          onDelete={() => deleteBeacon.mutate(b.id)}
        />
      ))}
      {deleteBeacon.isError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Couldn't delete: {(deleteBeacon.error as Error).message}
        </p>
      )}
    </div>
  );
}

interface BeaconCardProps {
  beacon: BeaconRow;
  deleting: boolean;
  onDelete: () => void;
}

function BeaconCard({ beacon, deleting, onDelete }: BeaconCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {beacon.label ?? <span className="italic text-muted-foreground">Unlabelled</span>}
            </span>
            {!isPlaced(beacon) && (
              <Badge variant="outline" className="text-[10px]">
                Unplaced
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {beacon.mac_address}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={deleting}
          aria-label={`Delete beacon ${beacon.label ?? beacon.mac_address}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
