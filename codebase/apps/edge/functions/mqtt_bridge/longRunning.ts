// Long-running entry point for the mqtt_bridge. Subscribes to the broker's
// `device/+/+` topic space, validates and persists each message via the
// shared `processMessage` SSOT (the same function the HTTP entry calls).
//
// Run from the repo root via:
//   npm run bridge:start
// which invokes:
//   deno run --env-file=apps/edge/.env \
//     --allow-net --allow-env --allow-read \
//     --import-map=apps/edge/deno.json \
//     apps/edge/functions/mqtt_bridge/longRunning.ts
//
// CROSS_CUTTING §11: this entry point holds the service-role key in env and
// never exposes it to clients. The HTTP entry (./index.ts) shares
// `processMessage` so CI exercises the same persistence path.

import mqtt from 'mqtt';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import { processMessage } from './processMessage.ts';

const BROKER_URL = Deno.env.get('MQTT_BROKER_URL') ?? 'mqtt://127.0.0.1:1883';
const MQTT_USERNAME = Deno.env.get('MQTT_USERNAME') ?? 'backend-bridge';
const MQTT_PASSWORD = Deno.env.get('MQTT_PASSWORD') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  const out = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra });
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  log('error', 'mqtt_bridge: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; refusing to start');
  Deno.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const client = mqtt.connect(BROKER_URL, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  reconnectPeriod: 5000,
  keepalive: 30,
  clientId: `bridge-${crypto.randomUUID()}`,
  will: {
    topic: 'bridge/status',
    payload: Buffer.from(JSON.stringify({ status: 'offline' })),
    qos: 1,
    retain: true,
  },
});

client.on('connect', () => {
  log('info', 'mqtt_bridge connected', { broker: BROKER_URL });
  client.subscribe('device/+/+', { qos: 0 }, (err) => {
    if (err) log('error', 'subscribe failed', { err: err.message });
    else log('info', 'subscribed', { topic: 'device/+/+' });
  });
});

client.on('message', async (topic, payload) => {
  let message: unknown;
  try {
    message = JSON.parse(payload.toString('utf-8'));
  } catch (e) {
    log('warn', 'invalid JSON payload', { topic, err: String(e) });
    return;
  }
  const outcome = await processMessage(topic, message, supabase, {
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!outcome.persisted) {
    const isExpectedNoOp =
      ('reason' in outcome && outcome.reason !== 'validation') ||
      ('error' in outcome && outcome.error === 'topic');
    const level = isExpectedNoOp ? 'info' : 'warn';
    log(level, 'process outcome', { topic, outcome });
  }
});

client.on('error', (err) => log('error', 'mqtt error', { err: err.message }));
client.on('reconnect', () => log('info', 'reconnecting', { broker: BROKER_URL }));
client.on('offline', () => log('warn', 'broker offline'));
client.on('close', () => log('info', 'connection closed'));

// Graceful shutdown on SIGTERM / SIGINT — Deno propagates these to the
// process; tear down the MQTT connection and exit.
function shutdown() {
  log('info', 'shutting down');
  client.end(false, {}, () => Deno.exit(0));
  // Hard-fail after 5s if the client refuses to close cleanly.
  setTimeout(() => Deno.exit(1), 5000);
}
Deno.addSignalListener('SIGINT', shutdown);
Deno.addSignalListener('SIGTERM', shutdown);
