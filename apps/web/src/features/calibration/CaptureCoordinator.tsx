import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePatientStreamContext } from '@/features/patients/PatientStreamContext';
import type { SignalsMessage } from '@alzcare/shared/mqtt';
import {
  EXTENDED_WINDOW_MS,
  INITIAL_WINDOW_MS,
  MIN_SAMPLES_TOTAL,
  STDDEV_TOP_N,
  accumulateSample,
  createAggregatorState,
  evaluateQuality,
  finaliseSignature,
  type AggregatorState,
} from './calibrationAggregator';
import { useCaptureCalibrationPoint } from './calibrationQueries';
import { QualityReadout, type CaptureStatus, type QualitySnapshot } from './QualityReadout';

interface CaptureCoordinatorProps {
  floorPlanId: string;
  pending: { x: number; y: number } | null;
  onSuccess: () => void;
  onCancel: () => void;
}

const SNAPSHOT_INTERVAL_MS = 100; // 10 Hz readout refresh

/** Owns the running aggregator state + timers for one capture window.
 *  Subscribes to onSignals via the patient-stream context, accumulates
 *  samples, runs the slice-3 quality check, and (on success) inserts
 *  the row via useCaptureCalibrationPoint. */
export function CaptureCoordinator({
  floorPlanId,
  pending,
  onSuccess,
  onCancel,
}: CaptureCoordinatorProps) {
  const { onSignals, status: streamStatus } = usePatientStreamContext();
  const capture = useCaptureCalibrationPoint(floorPlanId);

  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [reason, setReason] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<QualitySnapshot | null>(null);

  // Capture-side state lives in refs so timers + the streaming listener
  // mutate it without per-sample renders. The QualityReadout only
  // re-renders on the throttled snapshot pump below.
  const stateRef = useRef<AggregatorState | null>(null);
  const startedAtRef = useRef<number>(0);
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const finalisedRef = useRef(false);

  const tearDown = useCallback(() => {
    if (deadlineRef.current) clearTimeout(deadlineRef.current);
    if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
    unsubscribeRef.current?.();
    deadlineRef.current = null;
    snapshotTimerRef.current = null;
    unsubscribeRef.current = null;
  }, []);

  const finaliseAndWrite = useCallback(async () => {
    if (finalisedRef.current) return;
    finalisedRef.current = true;
    setStatus('finalising');
    const state = stateRef.current ?? createAggregatorState();
    const elapsed = Date.now() - startedAtRef.current;
    const { ble, wifi } = finaliseSignature(state, elapsed);
    const verdict = evaluateQuality(ble, wifi);
    if (!verdict.ok) {
      setStatus('failed');
      setReason(verdict.reason);
      tearDown();
      return;
    }
    if (!pending) {
      setStatus('failed');
      setReason('no_signals');
      tearDown();
      return;
    }
    try {
      await capture.mutateAsync({
        floor_plan_id: floorPlanId,
        x_canvas: pending.x,
        y_canvas: pending.y,
        ble_signature: ble,
        wifi_signature: wifi,
      });
      setStatus('success');
      tearDown();
      onSuccess();
    } catch (err) {
      setStatus('failed');
      setReason((err as Error).message);
      tearDown();
    }
  }, [capture, floorPlanId, onSuccess, pending, tearDown]);

  const startCapture = useCallback(() => {
    if (streamStatus !== 'subscribed') {
      setStatus('failed');
      setReason('stream_disconnected');
      return;
    }
    finalisedRef.current = false;
    stateRef.current = createAggregatorState();
    startedAtRef.current = Date.now();
    setStatus('capturing');
    setReason(undefined);
    setSnapshot({ total: 0, ble: 0, wifi: 0, topBle: [] });

    // Subscribe via the context's register fn — returns an unsub.
    unsubscribeRef.current = onSignals((msg: SignalsMessage) => {
      const s = stateRef.current;
      if (!s) return;
      accumulateSample(s, msg);
    });

    // Throttled readout pump.
    snapshotTimerRef.current = setInterval(() => {
      const s = stateRef.current;
      if (!s) return;
      setSnapshot(deriveSnapshot(s));
    }, SNAPSHOT_INTERVAL_MS);

    // 5-s deadline. If we're below the sample floor, extend to 10 s.
    deadlineRef.current = setTimeout(() => {
      const s = stateRef.current;
      if (!s) return;
      const total = totalSamples(s);
      if (total === 0) {
        // No signals at all — fail fast rather than wait the extra 5 s
        // for nothing.
        setReason('no_signals');
        setStatus('failed');
        tearDown();
        return;
      }
      if (total >= MIN_SAMPLES_TOTAL) {
        void finaliseAndWrite();
        return;
      }
      // Extend.
      setStatus('extending');
      deadlineRef.current = setTimeout(() => {
        void finaliseAndWrite();
      }, EXTENDED_WINDOW_MS - INITIAL_WINDOW_MS);
    }, INITIAL_WINDOW_MS);
  }, [finaliseAndWrite, onSignals, streamStatus, tearDown]);

  // Cleanup on unmount or pending-change. Cancelling the capture (e.g.
  // user navigated away) discards in-flight aggregation without writing.
  useEffect(() => {
    return () => {
      finalisedRef.current = true;
      tearDown();
    };
  }, [tearDown]);

  // Reset visible state when pending is cleared from outside (Cancel /
  // success handler in the parent).
  useEffect(() => {
    if (pending == null && status !== 'idle' && status !== 'capturing' && status !== 'extending') {
      setStatus('idle');
      setReason(undefined);
      setSnapshot(null);
    }
  }, [pending, status]);

  const isRunning = status === 'capturing' || status === 'extending' || status === 'finalising';
  const canCapture = pending != null && !isRunning && streamStatus === 'subscribed';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          {pending ? (
            <>
              Pending at{' '}
              <span className="font-mono text-foreground">
                ({pending.x}, {pending.y})
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Click a point on the floor plan to begin a capture.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pending && !isRunning && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" disabled={!canCapture} onClick={startCapture}>
            {isRunning ? 'Capturing…' : 'Capture'}
          </Button>
        </div>
      </div>
      {(status !== 'idle' || streamStatus !== 'subscribed') && (
        <QualityReadout
          status={status}
          snapshot={snapshot}
          reason={reason}
          streamStatus={streamStatus}
        />
      )}
    </div>
  );
}

function totalSamples(state: AggregatorState): number {
  let total = 0;
  for (const s of state.ble.values()) total += s.count;
  for (const s of state.wifi.values()) total += s.count;
  return total;
}

function deriveSnapshot(state: AggregatorState): QualitySnapshot {
  let bleTotal = 0;
  const top: { mac: string; rssi_mean: number; rssi_stddev: number; sample_count: number }[] = [];
  for (const [mac, stats] of state.ble) {
    bleTotal += stats.count;
    const stddev = stats.count >= 2 ? Math.sqrt(stats.m2 / (stats.count - 1)) : 0;
    top.push({
      mac,
      rssi_mean: stats.mean,
      rssi_stddev: stddev,
      sample_count: stats.count,
    });
  }
  let wifiTotal = 0;
  for (const stats of state.wifi.values()) wifiTotal += stats.count;
  top.sort((a, b) => b.rssi_mean - a.rssi_mean);
  return {
    total: bleTotal + wifiTotal,
    ble: bleTotal,
    wifi: wifiTotal,
    topBle: top.slice(0, STDDEV_TOP_N),
  };
}
