import { useEffect, useState } from 'react';
import { SignalsMessage, buildTopic, buildDeviceTopic } from '@alzcare/shared/mqtt';
import { useDiscoveredBeaconsStore } from '@/lib/stores/discoveredBeaconsStore';
import { useBroker } from './BrokerProvider';
import { fetchDeviceMacs } from './useBrokerTelemetry';

/**
 * Low-latency BLE discovery: subscribe directly to the broker's `signals`
 * topic for this patient — both the patient-keyed topic (sim/shim output) and
 * each paired device's MAC topic (real hardware) — and funnel every BLE sample
 * into the discovered-beacons store so the Beacons sub-tab's discovery list
 * reflects what's in range.
 *
 * This is the BLE counterpart to useBrokerTelemetry. Without it, beacon
 * discovery depended solely on the Supabase Realtime `…:signals` broadcast
 * (which only fires while the mqtt_bridge is running and republishing), so a
 * dashboard connected straight to HiveMQ saw live vitals but never beacons.
 * Both paths push into the same store; whichever sample is newer wins, exactly
 * like the telemetry direct/fallback split.
 *
 * Deliberately avoids react-query so it stays usable wherever the broker is
 * mounted, mirroring useBrokerTelemetry.
 */
export function useBrokerSignals(patientId: string | null): void {
  const { status, subscribe } = useBroker();
  const [macKey, setMacKey] = useState('');

  // Resolve paired-device MACs (refreshed occasionally) only while connected.
  useEffect(() => {
    if (status !== 'connected' || !patientId) {
      setMacKey('');
      return;
    }
    let cancelled = false;
    const load = () => {
      void fetchDeviceMacs(patientId)
        .then((macs) => {
          if (!cancelled) setMacKey(macs.join(','));
        })
        .catch(() => {
          /* RLS / transient — patient-keyed topic still covers sim/shim */
        });
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status, patientId]);

  useEffect(() => {
    if (status !== 'connected' || !patientId) return;
    const macs = macKey ? macKey.split(',') : [];
    const topics = [
      buildTopic(patientId, 'signals'),
      ...macs.map((m) => buildDeviceTopic(m, 'signals')),
    ];
    const push = useDiscoveredBeaconsStore.getState().pushSample;
    const unsub = subscribe(topics, (_topic, payload) => {
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      const parsed = SignalsMessage.safeParse(json);
      if (!parsed.success) return;
      const msg = parsed.data;
      // Trust the payload's patient_id so a MAC topic routes to the right
      // discovery list.
      for (const sample of msg.ble)
        push(msg.patient_id, sample.mac, sample.rssi, sample.battery_pct ?? null);
    });
    return unsub;
  }, [status, patientId, macKey, subscribe]);
}
