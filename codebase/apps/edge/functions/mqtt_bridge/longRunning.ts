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
// Local-compute: the bridge runs positioning + rules + inactivity IN-PROCESS
// (reusing the edge-function handlers) and writes the results to whichever
// Supabase it points at. This is what lets the on-prem ingest server feed a
// hosted dashboard without deploying any edge functions or DB webhooks.
import { handlePositionEstimateRequest } from '../position_estimator/handler.ts';
import { handleRulesEngineRequest } from '../rules_engine/handler.ts';
import { handleInactivityScan } from '../inactivity_scan/handler.ts';

const BROKER_URL = Deno.env.get('MQTT_BROKER_URL') ?? 'mqtt://127.0.0.1:1883';
const MQTT_USERNAME = Deno.env.get('MQTT_USERNAME') ?? 'backend-bridge';
const MQTT_PASSWORD = Deno.env.get('MQTT_PASSWORD') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Identifies this local ingest server in local_ingest_status (the dashboard's
// "local server online/offline" indicator). Single server → 'default'.
const INGEST_SERVER_ID = Deno.env.get('INGEST_SERVER_ID') ?? 'default';
const HEARTBEAT_MS = 5000;

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

// Liveness heartbeat: upsert local_ingest_status so the dashboard can show the
// local server as online/offline. Best-effort — a failed write (e.g. the table
// isn't migrated yet) is logged but never stops ingestion.
let brokerConnected = false;
async function heartbeat() {
  const { error } = await supabase.from('local_ingest_status').upsert({
    id: INGEST_SERVER_ID,
    last_seen_at: new Date().toISOString(),
    broker_connected: brokerConnected,
    bridge_version: 'bridge-1.0.0',
    updated_at: new Date().toISOString(),
  });
  if (error) log('warn', 'heartbeat upsert failed', { err: error.message });
}
void heartbeat();
const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);

client.on('connect', () => {
  brokerConnected = true;
  void heartbeat();
  log('info', 'mqtt_bridge connected', { broker: BROKER_URL });
  client.subscribe('device/+/+', { qos: 0 }, (err) => {
    if (err) log('error', 'subscribe failed', { err: err.message });
    else log('info', 'subscribed', { topic: 'device/+/+' });
  });
});

// ---- In-process compute (replaces deployed functions + DB webhooks) --------
const HANDLER_ENV = { serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY };

// A local Request that satisfies each handler's service-role bearer check.
function localRequest(body: unknown): Request {
  return new Request('http://local/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body ?? {}),
  });
}

// Fire alert rules for a freshly-inserted row (the rules_engine webhook shape).
async function dispatchRules(
  table: 'sensor_readings' | 'events' | 'position_estimates',
  recordId: string,
) {
  const { data: record, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', recordId)
    .maybeSingle();
  if (error || !record) {
    log('warn', 'rules dispatch: record fetch failed', { table, recordId, err: error?.message });
    return;
  }
  const res = await handleRulesEngineRequest(
    localRequest({ type: 'INSERT', table, record }),
    supabase,
    HANDLER_ENV,
  );
  if (!res.ok) log('warn', 'rules_engine non-2xx', { table, status: res.status });
}

// Compute a position fix from a signals message, then fire zone rules on it.
async function computePosition(signals: unknown) {
  const res = await handlePositionEstimateRequest(localRequest(signals), supabase, HANDLER_ENV);
  if (!res.ok) {
    log('warn', 'position_estimator non-2xx', { status: res.status });
    return;
  }
  const body = (await res.json()) as { position_estimate_id?: string | null };
  if (body.position_estimate_id)
    await dispatchRules('position_estimates', body.position_estimate_id);
}

client.on('message', async (topic, payload) => {
  let message: unknown;
  try {
    message = JSON.parse(payload.toString('utf-8'));
  } catch (e) {
    log('warn', 'invalid JSON payload', { topic, err: String(e) });
    return;
  }
  // No `env` → processMessage skips its HTTP position call; we run the whole
  // compute in-process below so nothing needs to be deployed.
  const outcome = await processMessage(topic, message, supabase);
  try {
    if (outcome.kind === 'telemetry' && outcome.persisted) {
      await dispatchRules('sensor_readings', outcome.rowId);
    } else if (outcome.kind === 'events' && outcome.persisted) {
      await dispatchRules('events', outcome.rowId);
    } else if (outcome.kind === 'signals' && outcome.reason === 'broadcast') {
      await computePosition(outcome.signals);
    }
  } catch (e) {
    log('warn', 'local compute failed', { topic, err: String(e) });
  }
  if (!outcome.persisted) {
    const isExpectedNoOp =
      ('reason' in outcome && outcome.reason !== 'validation') ||
      ('error' in outcome && outcome.error === 'topic');
    const level = isExpectedNoOp ? 'info' : 'warn';
    log(level, 'process outcome', { topic, outcome });
  }
});

// Inactivity + device-silence rules run on a tick (no DB cron in local-compute).
const inactivityTimer = setInterval(() => {
  void (async () => {
    try {
      const res = await handleInactivityScan(localRequest({}), supabase, HANDLER_ENV);
      if (!res.ok) log('warn', 'inactivity_scan non-2xx', { status: res.status });
    } catch (e) {
      log('warn', 'inactivity_scan failed', { err: String(e) });
    }
  })();
}, 60_000);

client.on('error', (err) => log('error', 'mqtt error', { err: err.message }));
client.on('reconnect', () => log('info', 'reconnecting', { broker: BROKER_URL }));
client.on('offline', () => {
  brokerConnected = false;
  void heartbeat();
  log('warn', 'broker offline');
});
client.on('close', () => {
  brokerConnected = false;
  log('info', 'connection closed');
});

// Graceful shutdown on SIGTERM / SIGINT — Deno propagates these to the
// process; tear down the MQTT connection and exit.
function shutdown() {
  log('info', 'shutting down');
  clearInterval(heartbeatTimer);
  clearInterval(inactivityTimer);
  client.end(false, {}, () => Deno.exit(0));
  // Hard-fail after 5s if the client refuses to close cleanly.
  setTimeout(() => Deno.exit(1), 5000);
}
Deno.addSignalListener('SIGINT', shutdown);
Deno.addSignalListener('SIGTERM', shutdown);
