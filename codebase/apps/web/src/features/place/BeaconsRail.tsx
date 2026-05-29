import { useState } from 'react';
import { Bluetooth, Check, MapPin, Pencil, Ruler, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { DiscoveryList } from '@/features/beacons/DiscoveryList';
import { isPlaced, type BeaconRow } from '@/features/beacons/types';
import { useRenameBeacon } from '@/features/beacons/beaconQueries';
import { publishFakeSignals } from '@/lib/devSignals';

const MIN_PLACED_FOR_F8 = 3;

interface BeaconsRailProps {
  patientId: string;
  beacons: BeaconRow[];
  pairedMacs: Set<string>;
  /** Both a saved plan and a calibrated scale are required before a
   *  beacon's (x, y) has real-world meaning. Pairing works without. */
  placementReady: boolean;
  planExists: boolean;
  deletingId: string | undefined;
  deleteError: string | null;
  onPair: (mac: string) => void;
  onPlace: (id: string) => void;
  onCalibrate: (beacon: BeaconRow) => void;
  onDelete: (id: string) => void;
}

/** Beacons section of the unified Place workspace rail. The placement
 *  surface itself is the shared canvas (Place arms it, a click drops the
 *  beacon); this rail owns discovery, the paired list, and the per-beacon
 *  actions. */
export function BeaconsRail({
  patientId,
  beacons,
  pairedMacs,
  placementReady,
  planExists,
  deletingId,
  deleteError,
  onPair,
  onPlace,
  onCalibrate,
  onDelete,
}: BeaconsRailProps) {
  const placed = beacons.filter(isPlaced).length;
  const showFewerNotice = placed < MIN_PLACED_FOR_F8;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionHeader
          title="Discovery"
          subtitle="BLE MACs picked up by the wearable. Pair each to give it a room."
          right={import.meta.env.DEV ? <DevInjectButton patientId={patientId} /> : null}
        />
        <DiscoveryList patientId={patientId} pairedMacs={pairedMacs} onPair={onPair} />
      </section>

      <section className="space-y-2">
        <SectionHeader
          title="Placement"
          subtitle={
            placementReady
              ? 'Click Place on a beacon, then click the floor plan to drop it. Drag a placed beacon to move it.'
              : 'Set up a floor plan with a calibrated scale before placing beacons.'
          }
        />
        {!placementReady && (
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {planExists
                ? 'Switch to the Floor plan section, select a wall and use Set scale to anchor pixels to metres.'
                : 'Switch to the Floor plan section and draw the patient’s space first.'}
            </span>
          </div>
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
                deleting={deletingId === b.id}
                placementReady={placementReady}
                onPlace={() => onPlace(b.id)}
                onCalibrate={() => onCalibrate(b)}
                onDelete={() => onDelete(b.id)}
              />
            ))}
            {deleteError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Couldn't delete: {deleteError}
              </p>
            )}
          </div>
        )}
      </section>
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

/** Dev-only fixture: publishes a fake validated SignalsMessage on the
 *  same broadcast channel the mqtt_bridge publishes on, so the demo path
 *  matches the real path. */
function DevInjectButton({ patientId }: { patientId: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void publishFakeSignals(patientId);
      }}
    >
      Inject fake signals
    </Button>
  );
}

interface BeaconCardProps {
  beacon: BeaconRow;
  deleting: boolean;
  placementReady: boolean;
  onPlace: () => void;
  onCalibrate: () => void;
  onDelete: () => void;
}

function BeaconCard({
  beacon,
  deleting,
  placementReady,
  onPlace,
  onCalibrate,
  onDelete,
}: BeaconCardProps) {
  const placed = isPlaced(beacon);
  const calibrated = beacon.rssi_at_1m != null;
  const rename = useRenameBeacon(beacon.patient_id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(beacon.label ?? '');

  function saveRename() {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== beacon.label) rename.mutate({ id: beacon.id, label: v });
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <span className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={saveRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename();
                    if (e.key === 'Escape') {
                      setDraft(beacon.label ?? '');
                      setEditing(false);
                    }
                  }}
                  className="h-7 w-44 text-sm"
                  placeholder="Beacon name"
                  aria-label="Beacon name"
                />
                <Button size="icon-sm" variant="ghost" onClick={saveRename} aria-label="Save name">
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="truncate text-sm font-medium text-foreground">
                  {beacon.label ?? <span className="italic text-muted-foreground">Unlabelled</span>}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(beacon.label ?? '');
                    setEditing(true);
                  }}
                  aria-label={`Rename beacon ${beacon.label ?? beacon.mac_address}`}
                  title="Rename beacon"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
            {!placed && (
              <Badge variant="outline" className="text-[10px]">
                Unplaced
              </Badge>
            )}
            {!calibrated && (
              <Badge variant="outline" className="text-[10px]">
                Uncalibrated
              </Badge>
            )}
            {calibrated && (
              <Badge variant="secondary" className="text-[10px] font-mono">
                {beacon.rssi_at_1m} dBm @ 1 m
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
            onClick={onCalibrate}
            title="Calibrate path-loss reference RSSI for this beacon"
          >
            <Ruler className="mr-1 h-3.5 w-3.5" />
            {calibrated ? 'Recalibrate' : 'Calibrate'}
          </Button>
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
