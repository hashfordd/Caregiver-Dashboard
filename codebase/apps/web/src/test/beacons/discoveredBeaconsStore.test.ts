import { describe, it, expect, beforeEach } from 'vitest';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';

const PATIENT_A = '11111111-1111-1111-1111-111111111111';
const PATIENT_B = '22222222-2222-2222-2222-222222222222';
const MAC_1 = 'AA:BB:CC:DD:EE:01';
const MAC_2 = 'AA:BB:CC:DD:EE:02';

beforeEach(() => {
  // Wipe both patients between tests so state from one case doesn't leak
  // into the next.
  useDiscoveredBeaconsStore.getState().reset(PATIENT_A);
  useDiscoveredBeaconsStore.getState().reset(PATIENT_B);
});

describe('discoveredBeaconsStore', () => {
  it('records firstSeen on the first sample and preserves it on subsequent samples', async () => {
    const { pushSample } = useDiscoveredBeaconsStore.getState();
    pushSample(PATIENT_A, MAC_1, -60);
    const firstSeenInitial =
      useDiscoveredBeaconsStore.getState().cards[PATIENT_A]?.[MAC_1]?.firstSeen;
    expect(firstSeenInitial).toBeTypeOf('number');

    // Wait at least one ms so lastSeen advances.
    await new Promise((r) => setTimeout(r, 2));
    pushSample(PATIENT_A, MAC_1, -55);
    const sample = useDiscoveredBeaconsStore.getState().cards[PATIENT_A]?.[MAC_1];
    expect(sample).toBeDefined();
    expect(sample!.firstSeen).toBe(firstSeenInitial);
    expect(sample!.lastRssi).toBe(-55);
    expect(sample!.lastSeen).toBeGreaterThan(firstSeenInitial!);
  });

  it('keeps cards per patient independent', () => {
    const { pushSample } = useDiscoveredBeaconsStore.getState();
    pushSample(PATIENT_A, MAC_1, -60);
    pushSample(PATIENT_B, MAC_2, -70);

    const cards = useDiscoveredBeaconsStore.getState().cards;
    expect(cards[PATIENT_A]).toBeDefined();
    expect(cards[PATIENT_A]![MAC_1]).toBeDefined();
    expect(cards[PATIENT_A]![MAC_2]).toBeUndefined();
    expect(cards[PATIENT_B]![MAC_2]).toBeDefined();
    expect(cards[PATIENT_B]![MAC_1]).toBeUndefined();
  });

  it('forget removes a single MAC for one patient and leaves the rest alone', () => {
    const { pushSample, forget } = useDiscoveredBeaconsStore.getState();
    pushSample(PATIENT_A, MAC_1, -60);
    pushSample(PATIENT_A, MAC_2, -65);
    pushSample(PATIENT_B, MAC_1, -70);

    forget(PATIENT_A, MAC_1);

    const cards = useDiscoveredBeaconsStore.getState().cards;
    expect(cards[PATIENT_A]![MAC_1]).toBeUndefined();
    expect(cards[PATIENT_A]![MAC_2]).toBeDefined();
    expect(cards[PATIENT_B]![MAC_1]).toBeDefined();
  });

  it('reset clears one patient and leaves the other intact', () => {
    const { pushSample, reset } = useDiscoveredBeaconsStore.getState();
    pushSample(PATIENT_A, MAC_1, -60);
    pushSample(PATIENT_B, MAC_1, -70);

    reset(PATIENT_A);

    const cards = useDiscoveredBeaconsStore.getState().cards;
    expect(cards[PATIENT_A]).toBeUndefined();
    expect(cards[PATIENT_B]![MAC_1]).toBeDefined();
  });

  it('drops non-finite RSSI values silently', () => {
    const { pushSample } = useDiscoveredBeaconsStore.getState();
    pushSample(PATIENT_A, MAC_1, Number.NaN);
    pushSample(PATIENT_A, MAC_1, Number.POSITIVE_INFINITY);
    expect(useDiscoveredBeaconsStore.getState().cards[PATIENT_A]).toBeUndefined();
  });
});
