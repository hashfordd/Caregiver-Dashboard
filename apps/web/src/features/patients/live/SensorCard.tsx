import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveSensorStore, type Metric } from '@/lib/stores/liveSensorStore';
import { cn } from '@/lib/utils';
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

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const lastReceivedAt = card?.lastReceivedAt ?? null;
  const isStale = lastReceivedAt != null && now - lastReceivedAt > STALE_MS;
  const ageSeconds = lastReceivedAt != null ? Math.round((now - lastReceivedAt) / 1000) : null;

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {LABELS[metric]}
        </CardTitle>
        <FreshnessPip stale={isStale} hasData={!!card?.latest} />
      </CardHeader>
      <CardContent>
        {card?.latest ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="font-serif italic text-5xl font-semibold tabular-nums leading-none text-foreground">
                {formatValue(metric, card.latest.value)}
              </span>
              <span className="text-sm font-medium text-muted-foreground">{UNITS[metric]}</span>
            </div>
            <p
              className={cn('mt-2 text-xs', isStale ? 'text-brandy-500' : 'text-muted-foreground')}
            >
              {isStale && ageSeconds != null
                ? `Stale · ${ageSeconds}s since last reading`
                : 'Live · streaming'}
            </p>
            <Sparkline
              points={card.buffer}
              className={cn('mt-3 w-full', isStale ? 'text-brandy-700' : 'text-tangerine-500')}
            />
          </>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Awaiting first reading…
          </div>
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
      <span className="h-2 w-2 rounded-full bg-muted-foreground/30" aria-label="no data yet" />
    );
  }
  return (
    <span className="relative flex h-2 w-2" aria-label={stale ? 'stale' : 'fresh'}>
      {!stale && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tangerine-500/60" />
      )}
      <span
        className={cn(
          'relative inline-flex h-2 w-2 rounded-full',
          stale ? 'bg-brandy-500' : 'bg-tangerine-500',
        )}
      />
    </span>
  );
}
