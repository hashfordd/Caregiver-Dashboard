import { Compass, Home, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

interface ModeIndicatorProps {
  estimate: PositionEstimateRow | undefined;
  className?: string;
}

/** Small pill that surfaces whether F8 has the patient as indoors
 *  (canvas position) or outdoors (GPS). When no estimate has arrived
 *  yet, renders a neutral "no fix" state. */
export function ModeIndicator({ estimate, className }: ModeIndicatorProps) {
  if (estimate == null) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground',
          className,
        )}
        aria-label="No position fix yet"
      >
        <Compass className="h-3 w-3" aria-hidden />
        No fix
      </span>
    );
  }
  if (estimate.mode === 'outdoor') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300',
          className,
        )}
        aria-label="Patient is outdoors"
      >
        <MapPin className="h-3 w-3" aria-hidden />
        Outdoor
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300',
        className,
      )}
      aria-label="Patient is indoors"
    >
      <Home className="h-3 w-3" aria-hidden />
      Indoor
    </span>
  );
}
