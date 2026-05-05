import { useMemo, useRef, useState } from 'react';
import { Bluetooth, MapPin, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';
import {
  BeaconPlacementCanvas,
  placedCount,
  type BeaconPlacementCanvasHandle,
} from './BeaconPlacementCanvas';
import { useBeacons, useDeleteBeacon } from './beaconQueries';
import { DiscoveryList } from './DiscoveryList';
import { PairDialog } from './PairDialog';
import { isPlaced, type BeaconRow } from './types';

const MIN_PLACED_FOR_F8 = 3;

interface BeaconsPanelProps {
  patientId: string;
}

export function BeaconsPanel({ patientId }: BeaconsPanelProps) {
  const beaconsQuery = useBeacons(patientId);
  const planQuery = useFloorPlan(patientId);
  const deleteBeacon = useDeleteBeacon(patientId);
  const [pairTarget, setPairTarget] = useState<string | null>(null);
  const placementRef = useRef<BeaconPlacementCanvasHandle | null>(null);

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
  const plan = planQuery.data ?? null;
  // Placement requires both a saved plan AND a calibrated scale — without
  // metric anchoring the (x_canvas, y_canvas) coords have no real-world
  // meaning. Pairing/discovery still work fine without either.
  const placementReady = plan != null && plan.scale_meters_per_pixel != null;
  const placed = placedCount(beacons);
  const showFewerNotice = placed < MIN_PLACED_FOR_F8;

  const handlePlaceClick = (id: string) => {
    placementRef.current?.arm(id);
  };

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
          title="Placement"
          subtitle={
            placementReady
              ? 'Click Place on a beacon, then click on the floor plan to drop it. Drag a placed beacon to move it.'
              : 'Set up a floor plan with a calibrated scale before placing beacons.'
          }
        />
        {placementReady ? (
          <div className="h-[min(60vh,720px)] min-h-[480px] w-full overflow-hidden rounded-lg border border-border bg-card">
            <BeaconPlacementCanvas
              ref={placementRef}
              patientId={patientId}
              floorPlan={plan}
              beacons={beacons}
            />
          </div>
        ) : (
          <EmptyState
            icon={<MapPin className="h-10 w-10" />}
            title={plan == null ? 'No floor plan yet' : 'Floor plan needs a scale'}
            description={
              plan == null
                ? 'Open the Floor plan sub-tab and draw the patient’s space first.'
                : 'In the Floor plan sub-tab, select a wall and use Set scale to anchor pixels to metres.'
            }
          />
        )}
        {showFewerNotice && beacons.length > 0 && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {placed < 1
              ? 'Fewer than 3 beacons placed. F8 indoor positioning will not run yet.'
              : `${placed} of ${MIN_PLACED_FOR_F8} beacons placed. Place ${MIN_PLACED_FOR_F8 - placed} more to unblock F8 indoor positioning.`}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeader
          title="Paired beacons"
          subtitle={
            beacons.length === 0
              ? 'Nothing paired yet — pair from the discovery list above.'
              : `${beacons.length} paired · ${placed} placed`
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
                placementReady={placementReady}
                onPlace={() => handlePlaceClick(b.id)}
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
          floorPlanId={plan?.id ?? null}
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
  placementReady: boolean;
  onPlace: () => void;
  onDelete: () => void;
}

function BeaconCard({ beacon, deleting, placementReady, onPlace, onDelete }: BeaconCardProps) {
  const placed = isPlaced(beacon);
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {beacon.label ?? <span className="italic text-muted-foreground">Unlabelled</span>}
            </span>
            {!placed && (
              <Badge variant="outline" className="text-[10px]">
                Unplaced
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {beacon.mac_address}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onPlace}
            disabled={!placementReady}
            title={
              placementReady
                ? placed
                  ? 'Re-place this beacon — next click on the canvas drops it'
                  : 'Place this beacon — next click on the canvas drops it'
                : 'Set up a floor plan with a scale first'
            }
          >
            {placed ? 'Move' : 'Place'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={deleting}
            aria-label={`Delete beacon ${beacon.label ?? beacon.mac_address}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
