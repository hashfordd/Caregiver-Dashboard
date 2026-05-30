import { useMemo } from 'react';
import {
  DEFAULT_PATH_LOSS_EXPONENT,
  DEFAULT_RSSI_AT_1M,
  pathLossDistance,
} from '@alzcare/shared/positioning';
import { useBeacons } from '@/features/beacons/beaconQueries';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';
import { useNow } from '@/lib/useNow';
import { useFloorPlan } from './floorPlanQueries';

/** Inline reference to the Python tracker dashboard's per-beacon readout:
 *  shows each placed beacon's last RSSI, the distance the path-loss
 *  formula derives from it, and how stale that sample is. Renders only
 *  what the positioning pipeline can actually see — beacons that have
 *  never been heard show "no signal", beacons without `rssi_at_1m`
 *  calibration are tagged with the default-substitution warning.
 *
 *  Pure read — joins three existing data sources (useBeacons,
 *  useFloorPlan, useDiscoveredBeaconsStore). No new MQTT subscriptions,
 *  no new queries.
 *
 *  Renders nothing while loading — the parent `LivePositionView`
 *  already shows skeletons for the floor plan card. */

const FRESH_MS = 5_000;
const STALE_MS = 30_000;

interface BeaconDiagnosticsPanelProps {
  patientId: string;
}

export function BeaconDiagnosticsPanel({ patientId }: BeaconDiagnosticsPanelProps) {
  const beaconsQuery = useBeacons(patientId);
  const planQuery = useFloorPlan(patientId);
  const discovered = useDiscoveredBeaconsStore((s) => s.cards[patientId]);
  // 2 s tick is enough for "fresh/stale" rendering; finer than the parent
  // marker view (5 s) because RSSI moves second-to-second.
  const nowMs = useNow(2_000);

  const pathLossExponent =
    planQuery.data?.path_loss_exponent != null && Number.isFinite(planQuery.data.path_loss_exponent)
      ? planQuery.data.path_loss_exponent
      : DEFAULT_PATH_LOSS_EXPONENT;

  const rows = useMemo(() => {
    const beacons = beaconsQuery.data ?? [];
    const cards = discovered ?? {};
    // Case-insensitive MAC match: the ESP32 reports lowercase, placed beacons
    // may be stored uppercase. Fold the discovery keys to lowercase once and
    // look up each beacon by its lowercased MAC.
    const cardsByMac = new Map(
      Object.entries(cards).map(([mac, sample]) => [mac.toLowerCase(), sample]),
    );
    return beacons
      .filter((b) => b.x_canvas != null && b.y_canvas != null)
      .map((b) => {
        const card = cardsByMac.get(b.mac_address.toLowerCase());
        const rssi = card?.lastRssi ?? null;
        const ageMs = card?.lastSeen != null ? nowMs - card.lastSeen : null;
        const rssi1m = b.rssi_at_1m ?? DEFAULT_RSSI_AT_1M;
        const usingDefault = b.rssi_at_1m == null;
        const distance =
          rssi != null && Number.isFinite(rssi)
            ? pathLossDistance(rssi, rssi1m, pathLossExponent)
            : null;
        return {
          id: b.id,
          label: b.label ?? b.mac_address.slice(-5),
          mac: b.mac_address,
          rssi,
          battery: card?.lastBattery ?? null,
          distance,
          ageMs,
          usingDefault,
        };
      });
  }, [beaconsQuery.data, discovered, nowMs, pathLossExponent]);

  if (planQuery.isLoading || beaconsQuery.isLoading) return null;
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No placed beacons yet — place at least 3 in the Beacons sub-tab to enable indoor tracking.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Beacon diagnostics
        </h4>
        <span className="text-[10px] text-muted-foreground">
          n = {pathLossExponent.toFixed(1)}
          {planQuery.data?.path_loss_exponent == null && (
            <span className="ml-1 text-muted-foreground/60">(default)</span>
          )}
        </span>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Beacon</th>
              <th className="px-2 py-1.5 font-medium">RSSI</th>
              <th className="px-2 py-1.5 font-medium">Battery</th>
              <th className="px-2 py-1.5 font-medium">Distance</th>
              <th className="px-2 py-1.5 font-medium">Last heard</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const status =
                r.ageMs == null
                  ? 'absent'
                  : r.ageMs < FRESH_MS
                    ? 'fresh'
                    : r.ageMs < STALE_MS
                      ? 'aged'
                      : 'stale';
              return (
                <tr key={r.id} className="bg-card">
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col leading-tight">
                      <span className="font-medium text-foreground">{r.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        …{r.mac.slice(-8)}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono">
                    {r.rssi != null ? (
                      `${r.rssi} dBm`
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {r.usingDefault && r.rssi != null && (
                      <span
                        className="ml-1 text-[10px] text-amber-700 dark:text-amber-300"
                        title="No calibrated rssi_at_1m on this beacon — pipeline substitutes the default."
                      >
                        no cal
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono">
                    {r.battery != null ? (
                      <span className={batteryColor(r.battery)}>{Math.round(r.battery)}%</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono">
                    {r.distance != null ? (
                      `${r.distance.toFixed(2)} m`
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={
                        status === 'fresh'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : status === 'aged'
                            ? 'text-amber-700 dark:text-amber-300'
                            : status === 'stale'
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                      }
                    >
                      {status === 'absent' ? 'never' : formatAge(r.ageMs!)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Distance derived from RSSI via the log-distance path-loss model the F8 pipeline uses; not
        the trilaterated position. Use as a per-beacon sanity check — three fresh, plausible
        distances → solid indoor fix.
      </p>
    </div>
  );
}

function batteryColor(pct: number): string {
  if (pct < 20) return 'text-destructive';
  if (pct < 50) return 'text-amber-700 dark:text-amber-300';
  return 'text-emerald-700 dark:text-emerald-300';
}

function formatAge(ms: number): string {
  if (ms < 1000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
