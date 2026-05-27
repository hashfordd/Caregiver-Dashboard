import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepperProps {
  steps: string[];
  /** Zero-based index of the active step. */
  current: number;
}

/** Compact horizontal stepper: numbered dots + labels, with completed steps
 *  showing a check and the connector filling in as you advance. */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className="flex items-center" aria-label="Setup progress">
      {steps.map((label, i) => {
        const complete = i < current;
        const active = i === current;
        return (
          <li key={label} className={cn('flex items-center', i < steps.length - 1 && 'flex-1')}>
            <div className="flex items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                  complete && 'border-emerald-500 bg-emerald-500 text-white',
                  active && 'border-primary bg-primary text-primary-foreground',
                  !complete && !active && 'border-border bg-background text-muted-foreground',
                )}
              >
                {complete ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'hidden text-xs font-medium sm:inline',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  'mx-2 h-px flex-1 transition-colors',
                  complete ? 'bg-emerald-500' : 'bg-border',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
