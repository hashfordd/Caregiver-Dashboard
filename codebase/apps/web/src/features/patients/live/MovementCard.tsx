import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { Sparkline } from './Sparkline';

const STALE_MS = 30 * 1000;

// Activity classification from accel magnitude deviation from 1 g (rest) plus
// gyro rotation rate. Tuned for the QMI8658 at rest (~1 g, a few deg/s of noise);
// a single spike is left to the existing fall rule — this card reflects sustained
// motion level. Thresholds are intentionally simple + adjustable.
const REST_DEV_G = 0.08; // |magnitude - 1g| below this ⇒ essentially still
const LIGHT_DEV_G = 0.3;
const REST_GYRO_DPS = 20;
const LIGHT_GYRO_DPS = 90;

type Activity = 'resting' | 'light' | 'active';

function classify(devG: number, gyroDps: number): Activity {
  if (devG < REST_DEV_G && gyroDps < REST_GYRO_DPS) return 'resting';
  if (devG < LIGHT_DEV_G && gyroDps < LIGHT_GYRO_DPS) return 'light';
  return 'active';
}

const ACTIVITY_LABEL: Record<Activity, string> = {
  resting: 'Resting',
  light: 'Light activity',
  active: 'Active',
};

function activityColor(a: Activity, stale: boolean): string {
  if (stale) return 'text-destructive';
  if (a === 'resting') return 'text-muted-foreground';
  if (a === 'light') return 'text-foreground';
  return 'text-amber-500 dark:text-amber-400';
}

interface MovementCardProps {
  patientId: string;
}

export function MovementCard({ patientId }: MovementCardProps) {
  const movement = useLiveSensorStore((s) => s.movement[patientId]);
  const now = useNow(1000);

  const lastReceivedAt = movement?.lastReceivedAt ?? null;
  const isStale = lastReceivedAt != null && now - lastReceivedAt > STALE_MS;
  const ageSeconds = lastReceivedAt != null ? Math.round((now - lastReceivedAt) / 1000) : null;

  const latest = movement?.latest ?? null;
  const devG = latest ? Math.abs(latest.magnitudeG - 1) : 0;
  const activity = latest ? classify(devG, latest.gyroDps) : null;

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Movement
        </CardTitle>
        <FreshnessPip stale={isStale} hasData={!!latest} />
      </CardHeader>
      <CardContent>
        {latest && activity ? (
          <>
            <div className="flex items-baseline">
              <span
                className={cn(
                  'font-serif italic text-3xl font-semibold leading-none',
                  activityColor(activity, isStale),
                )}
              >
                {ACTIVITY_LABEL[activity]}
              </span>
            </div>
            <p
              className={cn('mt-2 text-xs', isStale ? 'text-destructive' : 'text-muted-foreground')}
            >
              {isStale && ageSeconds != null
                ? `Stale · ${ageSeconds}s since last reading`
                : `${latest.magnitudeG.toFixed(2)} g · ${Math.round(latest.gyroDps)}°/s rotation`}
            </p>
            <Sparkline
              points={movement?.buffer ?? []}
              className={cn('mt-3 w-full', isStale ? 'text-destructive' : 'text-accent')}
            />
          </>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Awaiting motion data…
          </div>
        )}
      </CardContent>
    </Card>
  );
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
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
      )}
      <span
        className={cn(
          'relative inline-flex h-2 w-2 rounded-full',
          stale ? 'bg-destructive' : 'bg-accent',
        )}
      />
    </span>
  );
}
