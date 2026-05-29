import { describe, it, expect, beforeEach } from 'vitest';
import {
  celsiusToFahrenheit,
  formatTemperature,
  temperatureUnitSymbol,
  useTemperatureUnitStore,
} from '@/lib/units/temperature';

describe('temperature units', () => {
  beforeEach(() => {
    useTemperatureUnitStore.setState({ unit: 'c' });
  });

  it('converts Celsius to Fahrenheit', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(37)).toBeCloseTo(98.6, 1);
    expect(celsiusToFahrenheit(100)).toBe(212);
  });

  it('formats with the right symbol per unit (readings stored in Celsius)', () => {
    expect(formatTemperature(36.6, 'c')).toBe('36.6 °C');
    expect(formatTemperature(36.6, 'f')).toBe('97.9 °F');
    expect(temperatureUnitSymbol('c')).toBe('°C');
    expect(temperatureUnitSymbol('f')).toBe('°F');
  });

  it('defaults to Celsius and updates idempotently', () => {
    expect(useTemperatureUnitStore.getState().unit).toBe('c');
    const before = useTemperatureUnitStore.getState();
    before.setUnit('c'); // no-op, same reference
    expect(useTemperatureUnitStore.getState().unit).toBe('c');
    before.setUnit('f');
    expect(useTemperatureUnitStore.getState().unit).toBe('f');
  });
});
