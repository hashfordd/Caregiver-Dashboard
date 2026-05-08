// Mock telemetry publisher for the F4 spine smoke test. Publishes simulated
// telemetry on a configurable interval against a local Supabase + Mosquitto
// stack.
//
// Modes (transport):
//   --mode direct  (default) — service-role insert into sensor_readings.
//                  Fastest dev loop. Skips the mqtt_bridge entirely.
//                  Telemetry-only: signals are not persisted, so direct
//                  mode is unavailable when --kind signals.
//   --mode bridge  — POST validated payloads to the mqtt_bridge HTTP entry
//                  (`supabase functions serve mqtt_bridge` must be running).
//                  Exercises the bridge's processMessage SSOT over HTTP.
//   --mode mqtt    — Publish via the broker on `device/{patient_id}/<kind>`
//                  (`npm run broker:up && npm run bridge:start`). Exercises
//                  the full Phase 1/2 spine: firmware → broker → bridge →
//                  DB or realtime → dashboard.
//
// Kinds (message shape, orthogonal to mode):
//   --kind telemetry  (default) — TelemetryMessage with hr/spo2/temp.
//   --kind signals    — F6: SignalsMessage with 3 random BLE MACs at
//                       random RSSI in [-90, -50] each tick. Bridge mode
//                       re-broadcasts them on patient:<id>:signals.
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
import type { SignalsMessage } from '@alzcare/shared/mqtt';

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
    kind: { type: 'string', default: 'telemetry' },
    // Phase H item 70: refuse to run against a non-local URL by default.
    // Holding a service-role key, this CLI can write into prod by accident.
    'allow-non-local': { type: 'boolean', default: false },
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
const KIND = ((): 'telemetry' | 'signals' => {
  if (values.kind === 'signals') return 'signals';
  return 'telemetry';
})();
const URL = values.url ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = values['service-key'] ?? process.env.SB_SERVICE_KEY;
const BRIDGE_URL = values['bridge-url'] ?? `${URL}/functions/v1/mqtt_bridge`;
const MQTT_BROKER_URL = values['mqtt-broker-url'] ?? 'mqtt://127.0.0.1:1883';
const MQTT_USERNAME = values['mqtt-username'] ?? 'backend-bridge';
const MQTT_PASSWORD = values['mqtt-password'] ?? process.env.MQTT_BRIDGE_PASSWORD ?? null;

function fail(message: string): never {
  console.error(`mock-telemetry: ${message}`);
  process.exit(2);
}

/** Phase H item 70: non-local-target guard. The mock-telemetry CLI
 *  carries a service-role key and writes directly into sensor_readings
 *  / posts to the bridge — pointing it at a non-local URL by accident
 *  would inject fake telemetry into a real environment. Refuse unless
 *  --allow-non-local is passed or ALLOW_NON_LOCAL=1 is set. */
const ALLOW_NON_LOCAL = values['allow-non-local'] === true || process.env.ALLOW_NON_LOCAL === '1';

function isLocalUrl(raw: string): boolean {
  try {
    // `URL` is shadowed by the local SB URL constant; resolve the
    // global constructor explicitly.
    const u = new globalThis.URL(raw);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return false;
  }
}

function assertLocalOrAllowed(label: string, raw: string): void {
  if (isLocalUrl(raw) || ALLOW_NON_LOCAL) return;
  fail(
    `refusing to target non-local ${label} (${raw}). Pass --allow-non-local or set ALLOW_NON_LOCAL=1 to override.`,
  );
}

if (!PATIENT_ID) fail('--patient-id is required');
if (!DEVICE_ID) fail('--device-id is required');
if (!SERVICE_KEY) fail('SB_SERVICE_KEY env var or --service-key flag required');
if (MODE === 'mqtt' && !MQTT_PASSWORD)
  fail('MQTT_BRIDGE_PASSWORD env var or --mqtt-password flag is required for --mode mqtt');

assertLocalOrAllowed('Supabase URL', URL);
assertLocalOrAllowed('bridge URL', BRIDGE_URL);
if (MODE === 'mqtt') assertLocalOrAllowed('MQTT broker URL', MQTT_BROKER_URL);
if (KIND === 'signals' && MODE === 'direct') {
  // Signals are deliberately not persisted in V1. Direct-mode bypass
  // doesn't fit. Use --mode bridge to exercise the broadcast path.
  fail('--kind signals requires --mode bridge or --mode mqtt (signals are not persisted)');
}

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

// Stable set of mock MACs so a long-running session looks like a fixed
// installation (3 beacons in fixed rooms) rather than churning random
// MACs every tick. RSSI jitters within a realistic range.
const MOCK_BLE_MACS = ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02', 'AA:BB:CC:DD:EE:03'];

function nextSignalsMessage(): SignalsMessage {
  return {
    v: 1,
    patient_id: PATIENT_ID as string,
    device_id: DEVICE_ID as string,
    recorded_at: new Date().toISOString(),
    ble: MOCK_BLE_MACS.map((mac) => ({
      mac,
      // -90 to -50 dBm spread; closer beacons read stronger.
      rssi: -90 + Math.floor(Math.random() * 41),
    })),
    wifi: [],
  };
}

async function publishDirect(message: TelemetryMessage | SignalsMessage): Promise<void> {
  // Guarded earlier: --kind signals + --mode direct is rejected at startup
  // because signals are deliberately not persisted in V1. The narrow here
  // is therefore safe.
  if (!('hr_bpm' in message)) return;
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

async function publishBridge(message: TelemetryMessage | SignalsMessage): Promise<void> {
  const topic = buildTopic(message.patient_id, KIND);
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
    console.log(`pub bridge ${KIND} ${message.recorded_at}`);
  }
}

let mqttClient: mqtt.MqttClient | null = null;

function startMqtt(): Promise<mqtt.MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_BROKER_URL, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD ?? undefined,
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

function publishMqtt(message: TelemetryMessage | SignalsMessage): Promise<void> {
  if (!mqttClient) return Promise.reject(new Error('mqtt client not connected'));
  const topic = buildTopic(message.patient_id, KIND);
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

type AnyMessage = TelemetryMessage | SignalsMessage;
const publish: (m: AnyMessage) => Promise<void> =
  MODE === 'bridge' ? publishBridge : MODE === 'mqtt' ? publishMqtt : publishDirect;

const next: () => AnyMessage = KIND === 'signals' ? nextSignalsMessage : nextReading;

async function main(): Promise<void> {
  await ensureDevice();
  if (MODE === 'mqtt') {
    mqttClient = await startMqtt();
  }
  console.log(
    `mock-telemetry running: mode=${MODE} kind=${KIND} interval=${INTERVAL_MS}ms patient=${PATIENT_ID} device=${DEVICE_ID}`,
  );
  await publish(next());
  setInterval(() => {
    void publish(next());
  }, INTERVAL_MS);
}

function shutdown() {
  if (mqttClient) mqttClient.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void main();
