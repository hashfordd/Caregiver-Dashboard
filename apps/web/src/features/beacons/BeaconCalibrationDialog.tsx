import { useEffect, useRef, useState } from 'react';
import { Bluetooth, Loader2, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePatientStreamContext } from '@/features/patients/PatientStreamContext';
import { useUpdateBeaconCalibration } from './beaconQueries';
import type { BeaconRow } from './types';

interface BeaconCalibrationDialogProps {
  beacon: BeaconRow | null;
  patientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CAPTURE_WINDOW_MS = 5_000;
const MIN_SAMPLES = 5;

interface CaptureState {
  rssis: number[];
  startedAt: number;
}

type Phase = 'idle' | 'capturing' | 'review' | 'saving' | 'done' | 'failed';

/** F8 backlog item: in-app "stand 1 m from this beacon for 5 s" capture
 *  that writes `beacons.rssi_at_1m` (and a matching `tx_power`) back to
 *  the row. The path-loss model needs a per-beacon reference RSSI to
 *  produce metric distances; otherwise it falls back to a -59 dBm
 *  iBeacon-datasheet default and the trilateration path is the
 *  dominant systematic error in F8.
 *
 *  Implementation pattern mirrors F7's CaptureCoordinator: subscribe to
 *  onSignals via the patient-stream context, accumulate samples for
 *  this MAC into a ref, throttled progress readout, finalise on the
 *  5 s deadline.
 *
 *  Phase F item 53: caregivers can now Cancel a running capture
 *  (tears the listener + timers down without writing) and see a live
 *  countdown of how many seconds remain in the window. Previously the
 *  only options during capture were "wait it out" or "close the dialog
 *  and hope tearDown ran" — neither obvious. */
export function BeaconCalibrationDialog({
  beacon,
  patientId,
  open,
  onOpenChange,
}: BeaconCalibrationDialogProps) {
  const { onSignals, status: streamStatus } = usePatientStreamContext();
  const update = useUpdateBeaconCalibration(patientId);

  const [phase, setPhase] = useState<Phase>('idle');
  const [reason, setReason] = useState<string | undefined>();
  const [progress, setProgress] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);
  const [meanRssi, setMeanRssi] = useState<number | null>(null);

  const stateRef = useRef<CaptureState | null>(null);
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const tearDown = () => {
    if (deadlineRef.current) clearTimeout(deadlineRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    unsubscribeRef.current?.();
    deadlineRef.current = null;
    tickRef.current = null;
    unsubscribeRef.current = null;
  };

  // Reset on dialog open/close.
  useEffect(() => {
    if (!open) {
      tearDown();
      stateRef.current = null;
      setPhase('idle');
      setReason(undefined);
      setProgress(0);
      setSecondsRemaining(0);
      setSampleCount(0);
      setMeanRssi(null);
    }
    return () => tearDown();
  }, [open]);

  if (!beacon) return null;

  const startCapture = () => {
    if (streamStatus !== 'subscribed') {
      setPhase('failed');
      setReason('stream_disconnected');
      return;
    }
    setPhase('capturing');
    setReason(undefined);
    setProgress(0);
    setSecondsRemaining(Math.ceil(CAPTURE_WINDOW_MS / 1000));
    setSampleCount(0);
    setMeanRssi(null);
    stateRef.current = { rssis: [], startedAt: Date.now() };

    unsubscribeRef.current = onSignals((msg) => {
      const s = stateRef.current;
      if (!s) return;
      for (const sample of msg.ble) {
        if (sample.mac.toLowerCase() === beacon.mac_address.toLowerCase()) {
          s.rssis.push(sample.rssi);
        }
      }
    });

    tickRef.current = setInterval(() => {
      const s = stateRef.current;
      if (!s) return;
      const elapsed = Date.now() - s.startedAt;
      const remaining = Math.max(0, CAPTURE_WINDOW_MS - elapsed);
      setProgress(Math.min(1, elapsed / CAPTURE_WINDOW_MS));
      setSecondsRemaining(Math.ceil(remaining / 1000));
      setSampleCount(s.rssis.length);
      if (s.rssis.length > 0) {
        setMeanRssi(s.rssis.reduce((a, b) => a + b, 0) / s.rssis.length);
      }
    }, 100);

    deadlineRef.current = setTimeout(() => {
      finalise();
    }, CAPTURE_WINDOW_MS);
  };

  const cancelCapture = () => {
    tearDown();
    stateRef.current = null;
    setPhase('idle');
    setReason(undefined);
    setProgress(0);
    setSecondsRemaining(0);
    setSampleCount(0);
    setMeanRssi(null);
  };

  const finalise = () => {
    const s = stateRef.current;
    if (!s) return;
    tearDown();
    if (s.rssis.length < MIN_SAMPLES) {
      setPhase('failed');
      setReason('insufficient_samples');
      return;
    }
    const mean = s.rssis.reduce((a, b) => a + b, 0) / s.rssis.length;
    setMeanRssi(mean);
    setSampleCount(s.rssis.length);
    setPhase('review');
  };

  const save = async () => {
    if (meanRssi == null) return;
    setPhase('saving');
    try {
      // Round to nearest dBm — the bridge writes integers and the
      // path-loss model is insensitive at sub-dB precision anyway.
      const rounded = Math.round(meanRssi);
      await update.mutateAsync({ id: beacon.id, rssi_at_1m: rounded, tx_power: rounded });
      setPhase('done');
    } catch (err) {
      setPhase('failed');
      setReason((err as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="h-5 w-5 text-primary" />
            Calibrate beacon — {beacon.label ?? beacon.mac_address}
          </DialogTitle>
          <DialogDescription>
            Stand the wearable exactly 1 m from this beacon, hold still, and press Capture. We'll
            average 5 s of RSSI samples to set the path-loss reference for F8 indoor positioning.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Ruler className="h-4 w-4" />
              Current calibration:{' '}
              {beacon.rssi_at_1m == null ? (
                <span className="font-mono text-amber-700 dark:text-amber-300">
                  not set (using -59 dBm fallback)
                </span>
              ) : (
                <span className="font-mono text-foreground">{beacon.rssi_at_1m} dBm @ 1 m</span>
              )}
            </div>
          </div>

          {phase === 'capturing' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Capturing… {secondsRemaining} s remaining · {sampleCount} samples
                {meanRssi != null && <span className="ml-1">· mean {meanRssi.toFixed(1)} dBm</span>}
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-[width]"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'review' && meanRssi != null && (
            <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
              Captured <strong>{sampleCount}</strong> samples · mean RSSI{' '}
              <strong>{meanRssi.toFixed(1)} dBm</strong>. Saving will set both rssi_at_1m and
              tx_power to <strong>{Math.round(meanRssi)} dBm</strong>.
            </div>
          )}

          {phase === 'failed' && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              Calibration failed: {reasonText(reason)}
            </div>
          )}

          {phase === 'done' && (
            <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
              Calibration saved. F8 will use the new reference RSSI on the next signals tick.
            </div>
          )}

          {streamStatus !== 'subscribed' && phase === 'idle' && (
            <div className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              Realtime stream isn't connected — calibration needs live signals from the wearable.
              Reconnect and try again.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {phase === 'idle' && (
            <Button onClick={startCapture} disabled={streamStatus !== 'subscribed'}>
              Start 5 s capture
            </Button>
          )}
          {phase === 'capturing' && (
            <>
              <Button variant="outline" onClick={cancelCapture}>
                Cancel
              </Button>
              <Button variant="outline" disabled>
                Capturing… {secondsRemaining} s
              </Button>
            </>
          )}
          {phase === 'review' && (
            <>
              <Button variant="outline" onClick={() => setPhase('idle')}>
                Re-capture
              </Button>
              <Button onClick={save}>Save calibration</Button>
            </>
          )}
          {phase === 'saving' && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </Button>
          )}
          {(phase === 'done' || phase === 'failed') && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'stream_disconnected':
      return 'realtime stream is disconnected.';
    case 'insufficient_samples':
      return 'too few RSSI samples received in the 5 s window — check the wearable is in range and publishing signals.';
    default:
      return reason ?? 'unknown error.';
  }
}
