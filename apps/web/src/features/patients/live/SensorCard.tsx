import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveSensorStore, type Metric } from '@/lib/stores/liveSensorStore';
import { Sparkline } from './Sparkline';

const STALE_MS = 30 * 1000;

const LABELS: Record<Metric, string> = {
  hr: 'Heart rate',
  spo2: 'SpO₂',
  temp: 'Temperature',
};

const UNITS: Record<Metric, string> = {
  hr: 'bpm',
  spo2: '%',
  temp: '°C',
};

interface SensorCardProps {
  patientId: string;
  metric: Metric;
}

export function SensorCard({ patientId, metric }: SensorCardProps) {
  const card = useLiveSensorStore((s) => s.cards[patientId]?.[metric]);
  const [now, setNow] = useState(() => Date.now());

  // Tick every second so the "last updated" caption reflects time passing
  // even when no new row has arrived.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const lastReceivedAt = card?.lastReceivedAt ?? null;
  const isStale = lastReceivedAt != null && now - lastReceivedAt > STALE_MS;
  const ageSeconds = lastReceivedAt != null ? Math.round((now - lastReceivedAt) / 1000) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{LABELS[metric]}</CardTitle>
        <FreshnessPip stale={isStale} hasData={!!card?.latest} />
      </CardHeader>
      <CardContent>
        {card?.latest ? (
          <>
            <div className="text-3xl font-semibold tabular-nums">
              {formatValue(metric, card.latest.value)}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                {UNITS[metric]}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isStale && ageSeconds != null ? `Last updated ${ageSeconds}s ago` : 'Live'}
            </p>
            <Sparkline points={card.buffer} className="mt-3 w-full" />
          </>
        ) : (
          <div className="py-6 text-sm text-muted-foreground">Awaiting first reading…</div>
        )}
      </CardContent>
    </Card>
  );
}

function formatValue(metric: Metric, value: number): string {
  if (metric === 'temp') return value.toFixed(1);
  return Math.round(value).toString();
}

function FreshnessPip({ stale, hasData }: { stale: boolean; hasData: boolean }) {
  if (!hasData) {
    return (
      <span className="h-2 w-2 rounded-full bg-muted-foreground/40" aria-label="no data yet" />
    );
  }
  return (
    <span
      className={`h-2 w-2 rounded-full ${stale ? 'bg-yellow-500' : 'bg-green-500'}`}
      aria-label={stale ? 'stale' : 'fresh'}
    />
  );
}
