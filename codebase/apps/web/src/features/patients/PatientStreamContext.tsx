import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import {
  usePatientStream,
  type AlertRow,
  type PatientStreamHandle,
  type PositionEstimateRow,
  type SensorReadingRow,
  type SignalsMessage,
} from '@/lib/usePatientStream';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';
import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';

type Listener<T> = (row: T) => void;
type Unsubscribe = () => void;

export interface PatientStreamContextValue extends PatientStreamHandle {
  patientId: string;
  onSensorReading: (cb: Listener<SensorReadingRow>) => Unsubscribe;
  onPositionEstimate: (cb: Listener<PositionEstimateRow>) => Unsubscribe;
  onAlert: (cb: Listener<AlertRow>) => Unsubscribe;
  /** F6: subscribe to validated SignalsMessage broadcasts. The provider
   *  also automatically funnels every BLE sample into the discovered-
   *  beacons store, so most consumers don't need this — it's here for
   *  features that want the raw payload (e.g. F7 calibration capture). */
  onSignals: (cb: Listener<SignalsMessage>) => Unsubscribe;
}

const PatientStreamContext = createContext<PatientStreamContextValue | null>(null);

export function PatientStreamProvider({
  patientId,
  children,
}: {
  patientId: string;
  children: ReactNode;
}) {
  // Sets keep listener identity (ergo unsubscribe) precise across re-renders.
  const sensorListeners = useRef<Set<Listener<SensorReadingRow>>>(new Set());
  const positionListeners = useRef<Set<Listener<PositionEstimateRow>>>(new Set());
  const alertListeners = useRef<Set<Listener<AlertRow>>>(new Set());
  const signalsListeners = useRef<Set<Listener<SignalsMessage>>>(new Set());

  const handle = usePatientStream(patientId, {
    onSensorReading: (row) => {
      // Live store dispatch is the canonical home for sparkline buffers; the
      // fanout below feeds any feature that wants a per-row callback (e.g.
      // F12 alert flash, future telemetry-driven widgets).
      useLiveSensorStore.getState().pushReading(patientId, row);
      sensorListeners.current.forEach((cb) => cb(row));
    },
    onPositionEstimate: (row) => positionListeners.current.forEach((cb) => cb(row)),
    onAlert: (row) => alertListeners.current.forEach((cb) => cb(row)),
    onSignals: (msg) => {
      // F6: each BLE sample feeds the discovered-beacons store so the
      // Beacons sub-tab's discovery list reflects what's in range. The
      // raw payload still fans out to listeners for features that need
      // more than just MACs (e.g. F7 calibration capture aggregating
      // RSSI windows per beacon).
      const push = useDiscoveredBeaconsStore.getState().pushSample;
      for (const sample of msg.ble) push(patientId, sample.mac, sample.rssi);
      signalsListeners.current.forEach((cb) => cb(msg));
    },
  });

  const register = useRef({
    onSensorReading: (cb: Listener<SensorReadingRow>): Unsubscribe => {
      sensorListeners.current.add(cb);
      return () => {
        sensorListeners.current.delete(cb);
      };
    },
    onPositionEstimate: (cb: Listener<PositionEstimateRow>): Unsubscribe => {
      positionListeners.current.add(cb);
      return () => {
        positionListeners.current.delete(cb);
      };
    },
    onAlert: (cb: Listener<AlertRow>): Unsubscribe => {
      alertListeners.current.add(cb);
      return () => {
        alertListeners.current.delete(cb);
      };
    },
    onSignals: (cb: Listener<SignalsMessage>): Unsubscribe => {
      signalsListeners.current.add(cb);
      return () => {
        signalsListeners.current.delete(cb);
      };
    },
  });

  const value = useMemo<PatientStreamContextValue>(
    () => ({
      patientId,
      status: handle.status,
      lastSeen: handle.lastSeen,
      onSensorReading: register.current.onSensorReading,
      onPositionEstimate: register.current.onPositionEstimate,
      onAlert: register.current.onAlert,
      onSignals: register.current.onSignals,
    }),
    [patientId, handle.status, handle.lastSeen],
  );

  return <PatientStreamContext.Provider value={value}>{children}</PatientStreamContext.Provider>;
}

export function usePatientStreamContext(): PatientStreamContextValue {
  const ctx = useContext(PatientStreamContext);
  if (!ctx) {
    throw new Error('usePatientStreamContext must be used within <PatientStreamProvider>');
  }
  return ctx;
}
