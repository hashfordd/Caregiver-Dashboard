import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { ACTIVITY_LABEL, activityColor } from '@/lib/activity';
import { FreshnessPip } from './FreshnessPip';
import { Sparkline } from './Sparkline';

const STALE_MS = 30 * 1000;

interface MovementCardProps {
  patientId: string;
}

// The wearable reports heart rate + a 6-axis IMU (no SpO₂/temperature), so the
// movement card reflects the sustained motion level classified in the store
// (resting / light / active). A single spike is left to the fall rule.
export function MovementCard({ patientId }: MovementCardProps) {
  const movement = useLiveSensorStore((s) => s.movement[patientId]);
  const now = useNow(1000);

  const lastReceivedAt = movement?.lastReceivedAt ?? null;
  const isStale = lastReceivedAt != null && now - lastReceivedAt > STALE_MS;
  const ageSeconds = lastReceivedAt != null ? Math.round((now - lastReceivedAt) / 1000) : null;

  const latest = movement?.latest ?? null;
  const activity = movement?.activityState ?? null;

  return (
    <Card size="sm" className="relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0">
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
                  'font-serif italic text-2xl font-semibold leading-none',
                  activityColor(activity, isStale),
                )}
              >
                {ACTIVITY_LABEL[activity]}
              </span>
            </div>
            <p
              className={cn(
                'mt-1.5 text-xs',
                isStale ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {isStale && ageSeconds != null
                ? `Stale · ${ageSeconds}s since last reading`
                : `${latest.magnitudeG.toFixed(2)} g · ${Math.round(latest.gyroDps)}°/s rotation`}
            </p>
            <Sparkline
              points={movement?.buffer ?? []}
              height={28}
              className={cn('mt-2 w-full', isStale ? 'text-destructive' : 'text-accent')}
            />
          </>
        ) : (
          <div className="flex h-16 items-center justify-center text-sm text-muted-foreground">
            Awaiting motion data…
          </div>
        )}
      </CardContent>
    </Card>
  );
}
