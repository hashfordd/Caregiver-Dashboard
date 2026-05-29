import { useEffect } from 'react';
import { create } from 'zustand';
import { useCurrentCaregiver } from '@/features/provider/providerQueries';

// F4 / UI-05: caregiver-level temperature unit preference.
//
// Temperature is only surfaced in the F13 history VitalsChart today (the
// live view shows HR only — the wearable doesn't report temp), but the
// preference is app-wide so any future temp surface reads the same source.
//
// The unit lives in a tiny store (default 'c') rather than threading the
// caregiver query into every chart/card: components read the store with no
// Supabase dependency (so unit tests default to °C with zero setup), and a
// single sync hook hydrates it from the caregiver profile at the app shell.

export type TemperatureUnit = 'c' | 'f';

interface TemperatureUnitState {
  unit: TemperatureUnit;
  setUnit: (unit: TemperatureUnit) => void;
}

export const useTemperatureUnitStore = create<TemperatureUnitState>((set) => ({
  unit: 'c',
  setUnit: (unit) => set((state) => (state.unit === unit ? state : { unit })),
}));

/** Current display unit. Defaults to 'c' until the profile hydrates it. */
export function useTemperatureUnit(): TemperatureUnit {
  return useTemperatureUnitStore((s) => s.unit);
}

/** Hydrate the store from the signed-in caregiver's saved preference. Mount
 *  once at the app shell. No-op (stays 'c') until the profile query lands. */
export function useTemperatureUnitSync(): void {
  const me = useCurrentCaregiver();
  const saved = me.data?.temperature_unit;
  const setUnit = useTemperatureUnitStore((s) => s.setUnit);
  useEffect(() => {
    if (saved === 'c' || saved === 'f') setUnit(saved);
  }, [saved, setUnit]);
}

export function celsiusToFahrenheit(celsius: number): number {
  return celsius * 1.8 + 32;
}

/** Format a Celsius-stored reading for display in the chosen unit. */
export function formatTemperature(
  celsius: number,
  unit: TemperatureUnit,
  fractionDigits = 1,
): string {
  const value = unit === 'f' ? celsiusToFahrenheit(celsius) : celsius;
  return `${value.toFixed(fractionDigits)} ${temperatureUnitSymbol(unit)}`;
}

export function temperatureUnitSymbol(unit: TemperatureUnit): string {
  return unit === 'f' ? '°F' : '°C';
}
