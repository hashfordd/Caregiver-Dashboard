import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { AlertRow } from '@alzcare/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePatientsLookup } from '@/features/patients/usePatientsLookup';
import { AckButton } from './AckButton';
import { SEVERITY_STYLE, describeAlert } from './alertPresentation';
import { useAlertPopups } from './useAlertPopups';

/** App-wide modal that fires on a new unacked warn/critical alert.
 *  Mounted in AlertCueHost (→ AppLayout) so it interrupts on any route.
 *  Offers the two actions a caregiver needs in the moment: acknowledge,
 *  or jump straight to the patient. Closing without acknowledging leaves
 *  the alert unacked (still in the bell). */
export function AlertPopupHost() {
  const { active, remaining, dismiss } = useAlertPopups();
  const navigate = useNavigate();
  const lookup = usePatientsLookup();

  return (
    <Dialog
      open={active != null}
      onOpenChange={(next) => {
        if (!next && active) dismiss(active.id);
      }}
    >
      {active && (
        <AlertPopupContent
          key={active.id}
          alert={active}
          remaining={remaining}
          patientName={lookup.resolve(active.patient_id)}
          onAck={() => dismiss(active.id)}
          onJump={() => {
            navigate(`/patients/${active.patient_id}?tab=alerts`);
            dismiss(active.id);
          }}
        />
      )}
    </Dialog>
  );
}

function AlertPopupContent({
  alert,
  remaining,
  patientName,
  onAck,
  onJump,
}: {
  alert: AlertRow;
  remaining: number;
  patientName: string;
  onAck: () => void;
  onJump: () => void;
}) {
  const { Icon, bg, text } = SEVERITY_STYLE[alert.severity];
  const isCritical = alert.severity === 'critical';
  return (
    <DialogContent className={cn('border-2', bg)}>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              bg,
              text,
              isCritical && 'animate-pulse',
            )}
            aria-hidden
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle className={cn('truncate', text)}>
              {isCritical ? 'Critical alert' : 'Alert'} — {patientName}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {new Date(alert.fired_at).toLocaleString()}
            </p>
          </div>
        </div>
      </DialogHeader>

      <DialogDescription className="text-sm text-foreground">
        {describeAlert(alert)}
      </DialogDescription>

      {remaining > 0 && (
        <p className="text-xs text-muted-foreground">
          +{remaining} more alert{remaining > 1 ? 's' : ''} waiting
        </p>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onJump}>
          Jump to patient
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
        <AckButton alert={alert} variant="default" size="default" onAcked={onAck} />
      </DialogFooter>
    </DialogContent>
  );
}
