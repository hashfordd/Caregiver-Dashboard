// Mock telemetry publisher for the F4 spine smoke test. Publishes simulated
// telemetry on a configurable interval against a local Supabase + Mosquitto
// stack.
//
// Modes:
//   --mode direct  (default) — service-role insert into sensor_readings.
//                  Fastest dev loop. Skips the mqtt_bridge entirely.
//   --mode bridge  — POST validated payloads to the mqtt_bridge HTTP entry
//                  (`supabase functions serve mqtt_bridge` must be running).
//                  Exercises the bridge's processMessage SSOT over HTTP.
//   --mode mqtt    — Publish via the broker on `device/{patient_id}/telemetry`
//                  (`npm run broker:up && npm run bridge:start`). Exercises
//                  the full Phase 1 spine: firmware → broker → bridge → DB
//                  → realtime → dashboard.
//
// All modes ensure a `devices` row exists for the supplied --device-id and
// pairs it to --patient-id (unless --no-ensure-device is set). The device
// upsert always goes via the service-role Supabase client because the
// patient must own the device before any telemetry-driven flow makes
// sense.

import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import mqtt from 'mqtt';
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
    'mqtt-broker-url': { type: 'string', default: 'mqtt://127.0.0.1:1883' },
    'mqtt-username': { type: 'string', default: 'backend-bridge' },
    'mqtt-password': { type: 'string' },
    'no-ensure-device': { type: 'boolean', default: false },
  },
});

const PATIENT_ID = values['patient-id'];
const DEVICE_ID = values['device-id'];
const INTERVAL_MS = Number.parseInt(values.interval ?? '1000', 10);
const MODE = ((): 'direct' | 'bridge' | 'mqtt' => {
  if (values.mode === 'bridge') return 'bridge';
  if (values.mode === 'mqtt') return 'mqtt';
  return 'direct';
})();
const URL = values.url ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = values['service-key'] ?? process.env.SB_SERVICE_KEY;
const BRIDGE_URL = values['bridge-url'] ?? `${URL}/functions/v1/mqtt_bridge`;
const MQTT_BROKER_URL = values['mqtt-broker-url'] ?? 'mqtt://127.0.0.1:1883';
const MQTT_USERNAME = values['mqtt-username'] ?? 'backend-bridge';
const MQTT_PASSWORD = values['mqtt-password'] ?? process.env.MQTT_BRIDGE_PASSWORD ?? 'bridgepass';

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

let mqttClient: mqtt.MqttClient | null = null;

function startMqtt(): Promise<mqtt.MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_BROKER_URL, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      clientId: `mock-${(DEVICE_ID as string).slice(0, 8)}-${Date.now()}`,
      reconnectPeriod: 5000,
      keepalive: 30,
    });
    client.once('connect', () => {
      console.log(`mock-telemetry: mqtt connected ${MQTT_BROKER_URL}`);
      resolve(client);
    });
    client.once('error', (err) => reject(err));
  });
}

function publishMqtt(message: TelemetryMessage): Promise<void> {
  if (!mqttClient) return Promise.reject(new Error('mqtt client not connected'));
  const topic = buildTopic(message.patient_id, 'telemetry');
  return new Promise((resolve, reject) => {
    mqttClient!.publish(topic, JSON.stringify(message), { qos: 0 }, (err) => {
      if (err) {
        console.error(`mock-telemetry: mqtt publish — ${err.message}`);
        reject(err);
      } else {
        console.log(`pub mqtt ${topic} ${message.recorded_at}`);
        resolve();
      }
    });
  });
}

const publish = MODE === 'bridge' ? publishBridge : MODE === 'mqtt' ? publishMqtt : publishDirect;

async function main(): Promise<void> {
  await ensureDevice();
  if (MODE === 'mqtt') {
    mqttClient = await startMqtt();
  }
  console.log(
    `mock-telemetry running: mode=${MODE} interval=${INTERVAL_MS}ms patient=${PATIENT_ID} device=${DEVICE_ID}`,
  );
  await publish(nextReading());
  setInterval(() => {
    void publish(nextReading());
  }, INTERVAL_MS);
}

function shutdown() {
  if (mqttClient) mqttClient.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void main();
