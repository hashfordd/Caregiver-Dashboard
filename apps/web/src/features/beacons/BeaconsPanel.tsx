import { useMemo, useState } from 'react';
import { Bluetooth, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';
import { useBeacons, useDeleteBeacon } from './beaconQueries';
import { DiscoveryList } from './DiscoveryList';
import { PairDialog } from './PairDialog';
import { isPlaced, type BeaconRow } from './types';

interface BeaconsPanelProps {
  patientId: string;
}

export function BeaconsPanel({ patientId }: BeaconsPanelProps) {
  const beaconsQuery = useBeacons(patientId);
  const planQuery = useFloorPlan(patientId);
  const deleteBeacon = useDeleteBeacon(patientId);
  const [pairTarget, setPairTarget] = useState<string | null>(null);

  const pairedMacs = useMemo(
    () => new Set((beaconsQuery.data ?? []).map((b) => b.mac_address)),
    [beaconsQuery.data],
  );

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

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionHeader
          title="Discovery"
          subtitle="BLE MACs picked up by the wearable. Pair each to give it a room."
          right={import.meta.env.DEV ? <DevInjectButton patientId={patientId} /> : null}
        />
        <DiscoveryList
          patientId={patientId}
          pairedMacs={pairedMacs}
          onPair={(mac) => setPairTarget(mac)}
        />
      </section>

      <section className="space-y-2">
        <SectionHeader
          title="Paired beacons"
          subtitle={
            beacons.length === 0
              ? 'Nothing paired yet — pair from the discovery list above.'
              : `${beacons.length} paired`
          }
        />
        {beacons.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <Bluetooth className="h-5 w-5 text-muted-foreground" aria-hidden />
              <div className="text-sm text-muted-foreground">No beacons paired yet.</div>
            </CardContent>
          </Card>
        ) : (
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
        )}
      </section>

      {pairTarget != null && (
        <PairDialog
          open
          onOpenChange={(open) => {
            if (!open) setPairTarget(null);
          }}
          mac={pairTarget}
          patientId={patientId}
          floorPlanId={planQuery.data?.id ?? null}
        />
      )}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}

function SectionHeader({ title, subtitle, right }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

/** Dev-only fixture: drops random fake MAC samples into the discovered
 *  store so slice 2's UI is demo-able before slice 5's real bridge
 *  broadcast is wired up. Removed once `usePatientStream.onSignals` is
 *  fanning out — see slice 4. */
function DevInjectButton({ patientId }: { patientId: string }) {
  const pushSample = useDiscoveredBeaconsStore((s) => s.pushSample);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        const mac = randomMac();
        const rssi = -55 - Math.floor(Math.random() * 30);
        pushSample(patientId, mac, rssi);
      }}
    >
      Inject fake MAC
    </Button>
  );
}

function randomMac(): string {
  const hex = () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return Array.from({ length: 6 }, hex).join(':');
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
