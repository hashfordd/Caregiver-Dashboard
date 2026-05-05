import type { SignalsMessage } from '@alzcare/shared/mqtt';
import { supabase } from '@/lib/supabase';

/** Dev-only: publish a fake validated SignalsMessage on
 *  `patient:<id>:signals`. This is the same channel `usePatientStream`
 *  subscribes to, so the dashboard's discovery list will populate as if
 *  the mqtt_bridge had broadcast it (slice 5 wires the real bridge).
 *
 *  The browser uses the caregiver's session — no service role key. In
 *  V1, broadcast channels aren't RLS-protected; we rely on the patient_id
 *  in the channel name as the auth boundary. Logged in BACKLOG.md as a
 *  V2 follow-up. */
export async function publishFakeSignals(
  patientId: string,
  options: {
    macs?: string[];
    rssiRange?: [min: number, max: number];
  } = {},
): Promise<void> {
  const macs = options.macs ?? [randomMac(), randomMac(), randomMac()];
  const [rssiMin, rssiMax] = options.rssiRange ?? [-90, -50];
  const msg: SignalsMessage = {
    v: 1,
    patient_id: patientId,
    device_id: 'dev-console',
    recorded_at: new Date().toISOString(),
    ble: macs.map((mac) => ({ mac, rssi: randInt(rssiMin, rssiMax) })),
    wifi: [],
  };
  const channel = supabase.channel(`patient:${patientId}:signals`);
  channel.subscribe();
  // Wait one tick for the channel join to register, then send + tear down.
  await new Promise((r) => setTimeout(r, 100));
  await channel.send({ type: 'broadcast', event: 'signals', payload: msg });
  await supabase.removeChannel(channel);
}

function randomMac(): string {
  const hex = () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return Array.from({ length: 6 }, hex).join(':');
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Attach to window in dev so it's reachable from the browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __devSignals?: typeof publishFakeSignals }).__devSignals =
    publishFakeSignals;
}
