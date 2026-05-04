import { create } from 'zustand';
import type { SensorReadingRow } from '@alzcare/shared';

export type Metric = 'hr' | 'spo2' | 'temp';

export interface CardState {
  latest: { value: number; recordedAt: number } | null;
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

interface LiveSensorState {
  cards: Record<string, Record<Metric, CardState>>;
  pushReading: (patientId: string, row: SensorReadingRow) => void;
  reset: (patientId: string) => void;
}

export const useLiveSensorStore = create<LiveSensorState>((set) => ({
  cards: {},

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

      return { cards: { ...state.cards, [patientId]: next } };
    });
  },

  reset: (patientId) =>
    set((state) => {
      const next = { ...state.cards };
      delete next[patientId];
      return { cards: next };
    }),
}));
