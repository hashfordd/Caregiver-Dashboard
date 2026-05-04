// Mock telemetry publisher for the F4 spine smoke test. Publishes simulated
// telemetry on a configurable interval against a local Supabase stack.
//
// Modes:
//   --mode direct  (default) — service-role insert into sensor_readings.
//                  Fastest dev loop. Skips the mqtt_bridge.
//   --mode bridge  — POST validated payloads to the mqtt_bridge HTTP endpoint
//                  (`supabase functions serve mqtt_bridge` must be running).
//                  Exercises the bridge's processMessage SSOT.
//
// Both modes ensure a `devices` row exists for the supplied --device-id and
// pairs it to --patient-id (unless --no-ensure-device is set).
//
// Long-running MQTT mode (subscribed-from-broker) is the Phase 1 closure
// follow-up; see BACKLOG.

import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { buildTopic, type TelemetryMessage } from '@alzcare/shared';

const { values } = parseArgs({
  options: {
    'patient-id': { type: 'string' },
    'device-id': { type: 'string' },
    interval: { type: 'string', default: '1000' },
    mode: { type: 'string', default: 'direct' },
    url: { type: 'string', default: 'http://127.0.0.1:54321' },
    'service-key': { type: 'string' },
    'bridge-url': { type: 'string' },
    'no-ensure-device': { type: 'boolean', default: false },
  },
});

const PATIENT_ID = values['patient-id'];
const DEVICE_ID = values['device-id'];
const INTERVAL_MS = Number.parseInt(values.interval ?? '1000', 10);
const MODE = values.mode === 'bridge' ? 'bridge' : 'direct';
const URL = values.url ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = values['service-key'] ?? process.env.SB_SERVICE_KEY;
const BRIDGE_URL = values['bridge-url'] ?? `${URL}/functions/v1/mqtt_bridge`;

function fail(message: string): never {
  console.error(`mock-telemetry: ${message}`);
  process.exit(2);
}

if (!PATIENT_ID) fail('--patient-id is required');
if (!DEVICE_ID) fail('--device-id is required');
if (!SERVICE_KEY) fail('SB_SERVICE_KEY env var or --service-key flag required');

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureDevice(): Promise<void> {
  if (values['no-ensure-device']) return;
  const { error } = await supabase.from('devices').upsert({
    id: DEVICE_ID,
    mac_address: `mock-${(DEVICE_ID as string).slice(0, 12)}`,
    paired_patient_id: PATIENT_ID,
    last_seen_at: new Date().toISOString(),
    firmware_version: 'mock-1.0.0',
  });
  if (error) fail(`ensure-device failed: ${error.message}`);
  console.log(`mock-telemetry: device ${DEVICE_ID} paired to patient ${PATIENT_ID}`);
}

function nextReading(): TelemetryMessage {
  return {
    v: 1,
    patient_id: PATIENT_ID as string,
    device_id: DEVICE_ID as string,
    recorded_at: new Date().toISOString(),
    hr_bpm: Math.round(60 + Math.random() * 40),
    spo2_pct: Math.round((95 + Math.random() * 5) * 10) / 10,
    temp_c: Math.round((36.5 + (Math.random() - 0.5) * 0.6) * 10) / 10,
  };
}

async function publishDirect(message: TelemetryMessage): Promise<void> {
  const { error } = await supabase.from('sensor_readings').insert({
    patient_id: message.patient_id,
    device_id: message.device_id,
    recorded_at: message.recorded_at,
    hr_bpm: message.hr_bpm,
    spo2_pct: message.spo2_pct,
    temp_c: message.temp_c,
  });
  if (error) console.error(`mock-telemetry: insert error — ${error.message}`);
  else
    console.log(
      `pub direct ${message.recorded_at} hr=${message.hr_bpm} spo2=${message.spo2_pct} temp=${message.temp_c}`,
    );
}

async function publishBridge(message: TelemetryMessage): Promise<void> {
  const topic = buildTopic(message.patient_id, 'telemetry');
  const res = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ topic, message }),
  });
  if (!res.ok) {
    console.error(`mock-telemetry: bridge ${res.status} — ${await res.text()}`);
  } else {
    console.log(`pub bridge ${message.recorded_at}`);
  }
}

const publish = MODE === 'bridge' ? publishBridge : publishDirect;

async function main(): Promise<void> {
  await ensureDevice();
  console.log(
    `mock-telemetry running: mode=${MODE} interval=${INTERVAL_MS}ms patient=${PATIENT_ID} device=${DEVICE_ID}`,
  );
  await publish(nextReading());
  setInterval(() => {
    void publish(nextReading());
  }, INTERVAL_MS);
}

void main();
