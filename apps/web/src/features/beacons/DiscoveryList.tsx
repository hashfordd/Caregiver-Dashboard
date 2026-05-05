import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';

const STALE_MS = 30_000;

interface DiscoveryListProps {
  patientId: string;
  /** MACs already paired in beacons table — filtered out of the discovery
   *  list so we don't tempt the caregiver to re-pair. */
  pairedMacs: Set<string>;
  onPair: (mac: string) => void;
}

export function DiscoveryList({ patientId, pairedMacs, onPair }: DiscoveryListProps) {
  const cards = useDiscoveredBeaconsStore((s) => s.cards[patientId]);
  // 1s heartbeat so "first seen 47s ago" and the stale pip update
  // continuously, even when the signal stream is quiet. One re-render per
  // second regardless of how many MACs are listed.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const rows = Object.entries(cards ?? {})
    .filter(([mac]) => !pairedMacs.has(mac))
    .map(([mac, sample]) => ({ mac, ...sample }))
    .sort((a, b) => b.lastRssi - a.lastRssi);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <Radio className="h-5 w-5 text-muted-foreground" aria-hidden />
          <div className="text-sm text-muted-foreground">
            Listening for beacons… nothing in range yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const stale = now - row.lastSeen > STALE_MS;
        return (
          <Card key={row.mac}>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    aria-label={stale ? 'Stale' : 'Live'}
                    className={`h-2 w-2 rounded-full ${stale ? 'bg-amber-400' : 'bg-emerald-500'}`}
                  />
                  <span className="truncate font-mono text-sm text-foreground">{row.mac}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {row.lastRssi} dBm
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  First seen {formatAgo(now - row.firstSeen)} · last sample{' '}
                  {formatAgo(now - row.lastSeen)} ago
                </p>
              </div>
              <Button size="sm" onClick={() => onPair(row.mac)}>
                Pair
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function formatAgo(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
