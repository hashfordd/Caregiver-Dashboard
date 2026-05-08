import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';
import { DiscoveryList } from '@/features/beacons/DiscoveryList';

const PATIENT = '11111111-1111-1111-1111-111111111111';
const MAC_1 = 'AA:BB:CC:DD:EE:01';
const MAC_2 = 'AA:BB:CC:DD:EE:02';
const MAC_3 = 'AA:BB:CC:DD:EE:03';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-05T12:00:00Z'));
  useDiscoveredBeaconsStore.getState().reset(PATIENT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DiscoveryList', () => {
  it('renders an empty-listening card when nothing is in range', () => {
    render(<DiscoveryList patientId={PATIENT} pairedMacs={new Set()} onPair={() => {}} />);
    expect(screen.getByText(/listening for beacons/i)).toBeTruthy();
  });

  it('renders one card per discovered MAC sorted by RSSI desc, hides paired MACs, and fires onPair', () => {
    const onPair = vi.fn();
    const { pushSample } = useDiscoveredBeaconsStore.getState();
    pushSample(PATIENT, MAC_1, -75);
    pushSample(PATIENT, MAC_2, -55); // strongest
    pushSample(PATIENT, MAC_3, -65);

    // MAC_3 is already paired — should be filtered out.
    render(<DiscoveryList patientId={PATIENT} pairedMacs={new Set([MAC_3])} onPair={onPair} />);

    const macs = screen.getAllByText(/^AA:BB:CC:DD:EE:0[12]$/);
    expect(macs.map((el) => el.textContent)).toEqual([MAC_2, MAC_1]);
    expect(screen.queryByText(MAC_3)).toBeNull();

    // Click Pair on the strongest one — there are two Pair buttons; pick the first.
    const pairButtons = screen.getAllByRole('button', { name: /pair/i });
    pairButtons[0]!.click();
    expect(onPair).toHaveBeenCalledWith(MAC_2);
  });

  it('marks a MAC stale once its lastSeen is older than 30s, driven by the 1s heartbeat', () => {
    const { pushSample } = useDiscoveredBeaconsStore.getState();
    pushSample(PATIENT, MAC_1, -60);

    render(<DiscoveryList patientId={PATIENT} pairedMacs={new Set()} onPair={() => {}} />);
    expect(screen.getByLabelText(/^Live$/)).toBeTruthy();

    // Advance wall-clock by 31s; the row's lastSeen stays where it was, so
    // (now - lastSeen) > 30000. The 1s heartbeat forces a re-render that
    // recomputes the stale flag.
    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    expect(screen.getByLabelText(/^Stale$/)).toBeTruthy();
  });
});
