import { create } from 'zustand';

/** A single observation of a BLE MAC: most recent RSSI + battery%, plus the
 *  wall-clock timestamps for first / latest sighting in this patient's session. */
export interface DiscoveredSample {
  lastRssi: number;
  /** Beacon battery %, when the beacon advertises it; null if never reported. */
  lastBattery: number | null;
  lastSeen: number;
  firstSeen: number;
}

interface DiscoveredBeaconsState {
  /** Keyed by patient_id so signals from one patient's wearable don't bleed
   *  into another caregiver's discovery view. Mirrors liveSensorStore's
   *  cards-per-patient shape. */
  cards: Record<string, Record<string, DiscoveredSample>>;
  pushSample: (patientId: string, mac: string, rssi: number, battery?: number | null) => void;
  /** Drop a single MAC (called once it's been paired — pairing removes it
   *  from the discovery list since it now lives in the beacons table). */
  forget: (patientId: string, mac: string) => void;
  /** Wipe the discovery list for a patient (explicit "Clear" UX). */
  reset: (patientId: string) => void;
}

export const useDiscoveredBeaconsStore = create<DiscoveredBeaconsState>((set) => ({
  cards: {},

  pushSample: (patientId, mac, rssi, battery) => {
    if (!Number.isFinite(rssi)) return;
    const now = Date.now();
    const bat = typeof battery === 'number' && Number.isFinite(battery) ? battery : null;
    set((state) => {
      const existing = state.cards[patientId] ?? {};
      const prior = existing[mac];
      const next: DiscoveredSample = {
        lastRssi: rssi,
        // Keep the last known battery if this particular sample didn't carry one.
        lastBattery: bat ?? prior?.lastBattery ?? null,
        lastSeen: now,
        firstSeen: prior?.firstSeen ?? now,
      };
      return {
        cards: {
          ...state.cards,
          [patientId]: { ...existing, [mac]: next },
        },
      };
    });
  },

  forget: (patientId, mac) =>
    set((state) => {
      const existing = state.cards[patientId];
      if (!existing || !(mac in existing)) return state;
      const { [mac]: _drop, ...rest } = existing;
      return { cards: { ...state.cards, [patientId]: rest } };
    }),

  reset: (patientId) =>
    set((state) => {
      const next = { ...state.cards };
      delete next[patientId];
      return { cards: next };
    }),
}));
