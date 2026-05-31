import { Footprints, HeartPulse } from 'lucide-react';
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

/** "Where is the patient, and what are they doing" at a glance. Leads with the
 *  fused floor-plan location ("In bed" / "Near the front door" / the room) so
 *  it reads differently from the Movement card next to it — that card owns the
 *  raw motion level + g/°-per-s, this one owns place. The motion class is
 *  demoted to a one-line "<activity> · <time in state>" qualifier with current
 *  heart rate beneath. Reads only already-streaming data — no new network
 *  calls. */
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

  // Place is the hero: the specific furniture/door context ("In bed", "Near the
  // front door") when we have it, else the containing room, else unknown.
  const place = context?.text ?? roomName ?? null;
  const warn = context?.tone === 'warn';

  return (
    <Card size="sm" className={cn('relative overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0">
        <CardTitle className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Current activity
        </CardTitle>
        <FreshnessPip stale={stale} hasData={state != null} />
      </CardHeader>
      <CardContent>
        {state != null ? (
          <div className="space-y-2">
            <p
              className={cn(
                'font-serif italic text-2xl font-semibold leading-tight',
                warn ? 'text-amber-700 dark:text-amber-300' : 'text-foreground',
              )}
            >
              {place ?? 'Whereabouts unknown'}
            </p>

            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Footprints className="h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className={cn('font-medium', activityColor(state, stale))}>
                    {ACTIVITY_LABEL[state]}
                  </span>
                  {activity.since != null && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {timeInState(now - activity.since)}
                    </span>
                  )}
                </span>
              </p>
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
          <div className="flex h-16 items-center justify-center text-sm text-muted-foreground">
            Awaiting activity data…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact "time in this state": "<1 min", "12 min", "1 h 5 min". */
function timeInState(elapsedMs: number): string {
  const mins = Math.floor(elapsedMs / 60_000);
  if (mins < 1) return '<1 min';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs} h` : `${hrs} h ${rem} min`;
}
