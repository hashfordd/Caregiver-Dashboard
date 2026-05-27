import { useEffect, useState } from 'react';
import type { Device, SensorReadingRow } from '@alzcare/shared';
import { TelemetryMessage, buildTopic, buildDeviceTopic } from '@alzcare/shared/mqtt';
import { supabase } from '@/lib/supabase';
import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';
import { useBroker } from './BrokerProvider';

// Map a broker TelemetryMessage onto the SensorReadingRow shape the live store
// consumes. The store only reads recorded_at + hr/spo2/temp; id/created_at are
// synthesised since this row never touches the DB (it's a direct broker sample).
function telemetryToRow(t: TelemetryMessage): SensorReadingRow {
  return {
    id: crypto.randomUUID(),
    patient_id: t.patient_id,
    device_id: t.device_id,
    recorded_at: t.recorded_at,
    hr_bpm: t.hr_bpm ?? null,
    spo2_pct: t.spo2_pct ?? null,
    temp_c: t.temp_c ?? null,
    accel: t.accel ?? null,
    gyro: t.gyro ?? null,
    created_at: new Date().toISOString(),
  };
}

async function fetchDeviceMacs(patientId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('devices')
    .select('mac_address')
    .eq('paired_patient_id', patientId);
  if (error) throw error;
  return ((data ?? []) as Pick<Device, 'mac_address'>[]).map((d) => d.mac_address.toLowerCase());
}

/**
 * Low-latency live vitals: subscribe directly to the broker for this patient's
 * telemetry — both the patient-keyed topic (sim/shim output) and each paired
 * device's MAC topic (real hardware) — and push samples into the live sensor
 * store. Supabase realtime stays wired in PatientStreamProvider as the
 * persistence-backed fallback; whichever sample is newer wins in the store.
 *
 * Deliberately avoids react-query so it stays usable in PatientStreamProvider
 * unit tests that don't mount a QueryClient.
 */
export function useBrokerTelemetry(patientId: string | null): void {
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
      buildTopic(patientId, 'telemetry'),
      ...macs.map((m) => buildDeviceTopic(m, 'telemetry')),
    ];
    const push = useLiveSensorStore.getState().pushReading;
    const unsub = subscribe(topics, (_topic, payload) => {
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      const parsed = TelemetryMessage.safeParse(json);
      if (!parsed.success) return;
      // Trust the payload's patient_id so a MAC topic routes to the right store.
      push(parsed.data.patient_id, telemetryToRow(parsed.data));
    });
    return unsub;
  }, [status, patientId, macKey, subscribe]);
}
