import { HeartPulse, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { ACTIVITY_LABEL, activityColor } from '@/lib/activity';
import { useGatedPositionMarker } from '@/features/floor-plan/useGatedPositionMarker';
import { usePatientLocation } from '@/features/floor-plan/usePatientLocation';
import { FreshnessPip } from './FreshnessPip';
import { useActivity } from './useActivity';

interface ActivitySummaryCardProps {
  patientId: string;
  className?: string;
}

/** "What is the patient doing right now" at a glance: the IMU activity class
 *  fused with the floor-plan location ("Resting — In bed"), the containing room
 *  and time in this state, current heart rate, and freshness. Reads only
 *  already-streaming data — no new network calls. Sits to the right of the
 *  Movement card on the Live tab. */
export function ActivitySummaryCard({ patientId, className }: ActivitySummaryCardProps) {
  const activity = useActivity(patientId);
  const estimate = useGatedPositionMarker();
  const { context, roomName } = usePatientLocation(patientId, estimate);
  const hr = useLiveSensorStore((s) => s.cards[patientId]?.hr?.latest?.value ?? null);
  const now = useNow(1000);

  const state = activity.state;
  const stale = activity.stale;
  const ageSeconds =
    activity.lastReceivedAt != null ? Math.round((now - activity.lastReceivedAt) / 1000) : null;

  const location = context?.text ?? null;
  const headline = location ? `${ACTIVITY_LABEL[state ?? 'resting']} — ${location}` : null;

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Current activity
        </CardTitle>
        <FreshnessPip stale={stale} hasData={state != null} />
      </CardHeader>
      <CardContent>
        {state != null ? (
          <div className="space-y-3">
            <p
              className={cn(
                'font-serif italic text-3xl font-semibold leading-tight',
                activityColor(state, stale),
              )}
            >
              {headline ?? ACTIVITY_LABEL[state]}
            </p>

            <div className="space-y-1.5 text-sm">
              {(roomName || activity.since != null) && (
                <p
                  className={cn(
                    'flex items-center gap-1.5',
                    context?.tone === 'warn'
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-muted-foreground',
                  )}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {roomName && <span className="text-foreground">{roomName}</span>}
                    {roomName && activity.since != null && ' · '}
                    {activity.since != null && timeInState(now - activity.since)}
                  </span>
                </p>
              )}
              {hr != null && (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <HeartPulse className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    <span className="text-foreground tabular-nums">{Math.round(hr)}</span> bpm
                  </span>
                </p>
              )}
            </div>

            <p className={cn('text-xs', stale ? 'text-destructive' : 'text-muted-foreground')}>
              {stale && ageSeconds != null
                ? `Stale · ${ageSeconds}s since last reading`
                : ageSeconds != null && ageSeconds >= 1
                  ? `Updated ${ageSeconds}s ago`
                  : 'Live · streaming'}
            </p>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Awaiting activity data…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** "12 min in this state" / "Less than a minute in this state". */
function timeInState(elapsedMs: number): string {
  const mins = Math.floor(elapsedMs / 60_000);
  if (mins < 1) return 'less than a minute in this state';
  if (mins < 60) return `${mins} min in this state`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs} h in this state` : `${hrs} h ${rem} min in this state`;
}
