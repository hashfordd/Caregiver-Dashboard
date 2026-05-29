import { create } from 'zustand';
import type { SensorReadingRow } from '@alzcare/shared';

export type Metric = 'hr' | 'spo2' | 'temp';

export interface CardState {
  latest: { value: number; recordedAt: number } | null;
  buffer: { t: number; v: number }[];
  lastReceivedAt: number | null;
}

/**
 * Derived movement/activity state from the wearable's accelerometer (+ gyro).
 * Accel arrives in g (the shim converts the device's m/s² → g, ≈1.0 at rest),
 * gyro in deg/s. We keep the latest magnitudes, the raw vectors for detail, and
 * a rolling accel-magnitude buffer for the sparkline. Classification into
 * resting / light / active lives in the card so the store stays presentation-free.
 */
export interface MovementState {
  latest: { magnitudeG: number; gyroDps: number; recordedAt: number } | null;
  accel: { x: number; y: number; z: number } | null;
  gyro: { x: number; y: number; z: number } | null;
  buffer: { t: number; v: number }[];
  lastReceivedAt: number | null;
}

const FIVE_MIN_MS = 5 * 60 * 1000;

const METRIC_TO_FIELD: Record<Metric, 'hr_bpm' | 'spo2_pct' | 'temp_c'> = {
  hr: 'hr_bpm',
  spo2: 'spo2_pct',
  temp: 'temp_c',
};
const METRIC_KEYS: Metric[] = ['hr', 'spo2', 'temp'];

function emptyCard(): CardState {
  return { latest: null, buffer: [], lastReceivedAt: null };
}

function emptyPatient(): Record<Metric, CardState> {
  return { hr: emptyCard(), spo2: emptyCard(), temp: emptyCard() };
}

function emptyMovement(): MovementState {
  return { latest: null, accel: null, gyro: null, buffer: [], lastReceivedAt: null };
}

function mag3(v: { x: number; y: number; z: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

interface LiveSensorState {
  cards: Record<string, Record<Metric, CardState>>;
  /** Per-patient derived accelerometer activity (keyed by patient id). */
  movement: Record<string, MovementState>;
  pushReading: (patientId: string, row: SensorReadingRow) => void;
  reset: (patientId: string) => void;
}

export const useLiveSensorStore = create<LiveSensorState>((set) => ({
  cards: {},
  movement: {},

  pushReading: (patientId, row) => {
    const recordedAt = new Date(row.recorded_at).getTime();
    if (Number.isNaN(recordedAt)) return;
    const now = Date.now();
    const cutoff = recordedAt - FIVE_MIN_MS;

    set((state) => {
      const existing = state.cards[patientId] ?? emptyPatient();
      const next: Record<Metric, CardState> = { ...existing };

      for (const metric of METRIC_KEYS) {
        const value = row[METRIC_TO_FIELD[metric]];
        if (typeof value !== 'number') continue;
        const prev = existing[metric];
        const buffer = [...prev.buffer, { t: recordedAt, v: value }].filter((p) => p.t >= cutoff);
        next[metric] = {
          latest: { value, recordedAt },
          buffer,
          lastReceivedAt: now,
        };
      }

      const result: Partial<LiveSensorState> = {
        cards: { ...state.cards, [patientId]: next },
      };

      // Movement: only update when the reading actually carries an accel vector,
      // so accel-less rows (e.g. an HR-only sample) don't churn the movement card.
      if (row.accel) {
        const prev = state.movement[patientId] ?? emptyMovement();
        const magnitudeG = mag3(row.accel);
        const gyroDps = row.gyro ? mag3(row.gyro) : 0;
        const buffer = [...prev.buffer, { t: recordedAt, v: magnitudeG }].filter(
          (p) => p.t >= cutoff,
        );
        result.movement = {
          ...state.movement,
          [patientId]: {
            latest: { magnitudeG, gyroDps, recordedAt },
            accel: row.accel,
            gyro: row.gyro ?? null,
            buffer,
            lastReceivedAt: now,
          },
        };
      }

      return result;
    });
  },

  reset: (patientId) =>
    set((state) => {
      const cards = { ...state.cards };
      delete cards[patientId];
      const movement = { ...state.movement };
      delete movement[patientId];
      return { cards, movement };
    }),
}));
