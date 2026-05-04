import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import {
  usePatientStream,
  type AlertRow,
  type PatientStreamHandle,
  type PositionEstimateRow,
  type SensorReadingRow,
} from '@/lib/usePatientStream';

type Listener<T> = (row: T) => void;
type Unsubscribe = () => void;

export interface PatientStreamContextValue extends PatientStreamHandle {
  patientId: string;
  onSensorReading: (cb: Listener<SensorReadingRow>) => Unsubscribe;
  onPositionEstimate: (cb: Listener<PositionEstimateRow>) => Unsubscribe;
  onAlert: (cb: Listener<AlertRow>) => Unsubscribe;
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

  const handle = usePatientStream(patientId, {
    onSensorReading: (row) => sensorListeners.current.forEach((cb) => cb(row)),
    onPositionEstimate: (row) => positionListeners.current.forEach((cb) => cb(row)),
    onAlert: (row) => alertListeners.current.forEach((cb) => cb(row)),
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
  });

  const value = useMemo<PatientStreamContextValue>(
    () => ({
      patientId,
      status: handle.status,
      lastSeen: handle.lastSeen,
      onSensorReading: register.current.onSensorReading,
      onPositionEstimate: register.current.onPositionEstimate,
      onAlert: register.current.onAlert,
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
