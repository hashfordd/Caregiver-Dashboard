// protocol-shim
// ----------------------------------------------------------------------------
// Bridges the hardware prototype's MQTT dialect to the canonical contract the
// mqtt_bridge ingests. The real sensor components publish:
//
//     patient/{proto_id}/raw/heartrate   {value, unit, ...}
//     patient/{proto_id}/raw/imu         {ax, ay, az, yaw, pitch, tilt, movement_rate, ...}
//     patient/{proto_id}/raw/location    {... BLE RSSI to beacons ...}
//
// The current physical device instead publishes ONE combined message per tick:
//
//     alzcare/{site}/patient{n}/total   {patient_id, bpm, acc_*_mps2, gyro_*_dps,
//                                        gps_status, ble_devices:[…], …}
//
// This process subscribes to both dialects and re-publishes on the canonical
// device/{patient_uuid}/{telemetry,signals,events} topics with v:1, Zod-valid
// payloads. The existing spine (bridge → DB → position_estimator → rules_engine
// → alerts → realtime → dashboard) then runs unchanged.
//
// All mapping + fall-latch logic lives in ./lib/transform.ts (unit-tested);
// this file is just MQTT/Supabase I/O, arg parsing, and logging.
//
// The broker is HiveMQ Cloud (mqtts://<cluster>.s1.eu.hivemq.cloud:8883). Broker
// URL / username / password come from the --mqtt-* flags or, when those are
// omitted, the MQTT_BROKER_URL / MQTT_USERNAME / MQTT_(BRIDGE_)PASSWORD env vars.

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import mqtt from 'mqtt';
import { buildTopic } from '@alzcare/shared';
import {
  LIVE_TEST_PROTO_ID,
  LIVE_TEST_PATIENT_ID,
  LIVE_TEST_DEVICE_ID,
} from '@alzcare/shared/fixtures';
import {
  type Mapping,
  type ShimState,
  type SynthContext,
  type BeaconAnchor,
  freshState,
  ingestHeartRate,
  ingestImu,
  ingestLocation,
  ingestTotal,
} from './lib/transform.ts';
import { createPairingResolver, normalizeMac, type PairingResolver } from './lib/pairing.ts';

// ---- Args ------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    'mqtt-broker-url': { type: 'string' },
    'mqtt-username': { type: 'string' },
    'mqtt-password': { type: 'string' },
    'proto-id': { type: 'string', default: '001' },
    'patient-id': { type: 'string' },
    'device-id': { type: 'string' },
    'map-file': { type: 'string' },
    url: { type: 'string', default: 'http://127.0.0.1:54321' },
    'service-key': { type: 'string' },
    'no-ensure-device': { type: 'boolean', default: false },
    'allow-non-local': { type: 'boolean', default: false },
  },
});

const MQTT_BROKER_URL = values['mqtt-broker-url'] ?? process.env.MQTT_BROKER_URL ?? '';
const MQTT_USERNAME = values['mqtt-username'] ?? process.env.MQTT_USERNAME ?? '';
const MQTT_PASSWORD =
  values['mqtt-password'] ?? process.env.MQTT_BRIDGE_PASSWORD ?? process.env.MQTT_PASSWORD ?? null;

if (!MQTT_BROKER_URL) {
  fail(
    'no broker URL — pass --mqtt-broker-url or set MQTT_BROKER_URL ' +
      '(HiveMQ: mqtts://<cluster>.s1.eu.hivemq.cloud:8883)',
  );
}
const SB_URL = values.url ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = values['service-key'] ?? process.env.SB_SERVICE_KEY ?? null;
const ENSURE_DEVICE = values['no-ensure-device'] !== true;
const ALLOW_NON_LOCAL = values['allow-non-local'] === true || process.env.ALLOW_NON_LOCAL === '1';

// One Supabase client for the process lifetime: powers device-ensure, beacon
// reads, and (the live path) MAC→patient pairing lookups. Null when no service
// key is given — the shim then falls back to the static flag/fixture mappings.
const sb: SupabaseClient | null = SERVICE_KEY
  ? createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// Live pairing: resolve a device's own MAC (carried in the combined payload) to
// the patient + device it was paired to in the dashboard. The TTL cache lives in
// lib/pairing.ts; here we just supply the DB lookup.
const pairing: PairingResolver | null = sb
  ? createPairingResolver(async (mac) => {
      const { data, error } = await sb
        .from('devices')
        .select('id, paired_patient_id')
        .eq('mac_address', mac)
        .maybeSingle();
      if (error) {
        console.error(`protocol-shim: pairing lookup failed for ${mac} — ${error.message}`);
        return null;
      }
      if (!data?.paired_patient_id) return null;
      return { patient_id: data.paired_patient_id as string, device_id: data.id as string };
    })
  : null;

function fail(message: string): never {
  console.error(`protocol-shim: ${message}`);
  process.exit(2);
}

// ---- ID mapping ------------------------------------------------------------

function loadMappings(): Map<string, Mapping> {
  const map = new Map<string, Mapping>();

  if (values['map-file']) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(values['map-file'], 'utf8'));
    } catch (err) {
      fail(`could not read --map-file: ${(err as Error).message}`);
    }
    if (typeof raw !== 'object' || raw === null) fail('--map-file must be a JSON object');
    for (const [protoId, entry] of Object.entries(raw as Record<string, unknown>)) {
      const e = entry as Partial<Mapping>;
      if (!e.patient_id || !e.device_id) {
        fail(`--map-file entry "${protoId}" needs both patient_id and device_id`);
      }
      map.set(protoId, { patient_id: e.patient_id, device_id: e.device_id });
    }
  } else if (values['patient-id'] && values['device-id']) {
    map.set(values['proto-id'] ?? '001', {
      patient_id: values['patient-id'],
      device_id: values['device-id'],
    });
  } else {
    // No flags: default to the canonical live-feed test patient so
    // `npm run shim:start` just works after `npm run seed:live`.
    map.set(LIVE_TEST_PROTO_ID, {
      patient_id: LIVE_TEST_PATIENT_ID,
      device_id: LIVE_TEST_DEVICE_ID,
    });
  }

  return map;
}

const MAPPINGS = loadMappings();

// Whether the operator supplied an explicit mapping (--map-file or
// --patient-id/--device-id) vs the implicit fixture default. The live
// combined-dialect path refuses the fixture default: real devices must be paired
// in the dashboard by MAC — no hardcoded patient/device IDs in the live flow.
const MAPPINGS_EXPLICIT =
  values['map-file'] != null || (values['patient-id'] != null && values['device-id'] != null);

// ---- Local-target guard ----------------------------------------------------
// ensure-device carries a service-role key; refuse to touch a non-local
// Supabase by accident (mirrors mock-telemetry's Phase H item 70 guard).
function isLocalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return false;
  }
}

// The device row is normally created by `seed:live`, so a missing service key
// is not fatal — we just skip the redundant ensure rather than refusing to run.
const ALLOW_SYNTH =
  process.env.ALZCARE_SHIM_ALLOW_SYNTH === '1' || process.env.ALZCARE_SHIM_ALLOW_SYNTH === 'true';
if (ALLOW_SYNTH) {
  console.warn(
    '[shim] SYNTHETIC BLE enabled (ALZCARE_SHIM_ALLOW_SYNTH) — fabricating RSSI from fixtures; NOT real hardware',
  );
}

const CAN_ENSURE_DEVICE = ENSURE_DEVICE && !!SERVICE_KEY;
if (ENSURE_DEVICE && !SERVICE_KEY) {
  console.warn(
    'protocol-shim: no SB_SERVICE_KEY — skipping device ensure (run `npm run seed:live` to create it).',
  );
}
if (CAN_ENSURE_DEVICE && !isLocalUrl(SB_URL) && !ALLOW_NON_LOCAL) {
  fail(`refusing to target non-local Supabase (${SB_URL}); pass --allow-non-local to override`);
}

// ---- Per-patient state -----------------------------------------------------

const state = new Map<string, ShimState>();

// Per-patient beacon layout + scale, fetched from the DB at startup. The walk
// is synthesised against these (the software-placed beacons), not hardcoded.
const synthByProto = new Map<string, SynthContext>();

function stateFor(protoId: string): ShimState {
  let s = state.get(protoId);
  if (!s) {
    s = freshState();
    state.set(protoId, s);
  }
  return s;
}

// ---- Topic parsing ---------------------------------------------------------

const RAW_TOPIC_RE = /^patient\/([^/]+)\/raw\/(heartrate|imu|location)$/;

function parseRawTopic(topic: string): { protoId: string; kind: string } | null {
  const m = RAW_TOPIC_RE.exec(topic);
  if (!m || !m[1] || !m[2]) return null;
  return { protoId: m[1], kind: m[2] };
}

// The real hardware publishes one combined message per tick on
// `alzcare/{site}/{id}/total`. The third segment is just a routing label — the
// device's identity comes from `device_mac` in the payload — so we accept any id
// and only strip an optional `patient` prefix (so a hand-set `patient001` still
// maps for the explicit-flag test path).
const TOTAL_TOPIC_RE = /^alzcare\/[^/]+\/([^/]+)\/total$/;

function parseTotalTopic(topic: string): { protoId: string } | null {
  const m = TOTAL_TOPIC_RE.exec(topic);
  if (!m || !m[1]) return null;
  return { protoId: m[1].replace(/^patient/i, '') || m[1] };
}

// ---- MQTT client -----------------------------------------------------------

let client: mqtt.MqttClient;

function publishCanonical(topic: string, message: object): void {
  client.publish(topic, JSON.stringify(message), { qos: 0 }, (err) => {
    if (err) console.error(`protocol-shim: publish ${topic} failed — ${err.message}`);
  });
}

// ---- Message router --------------------------------------------------------

let locationWarned = false;

// Shared front door for both dialects: resolve the proto-id mapping and parse
// JSON once, then hand off to the per-dialect handler.
function onMessage(topic: string, buf: Buffer): void {
  const raw = parseRawTopic(topic);
  if (raw) {
    const ctx = prepare(raw.protoId, buf, topic);
    if (ctx) handleRaw(raw.kind, ctx.map, ctx.payload, ctx.protoId, ctx.now);
    return;
  }
  const total = parseTotalTopic(topic);
  if (total) void handleTotalMessage(total.protoId, buf, topic);
}

interface MessageContext {
  map: Mapping;
  payload: Record<string, unknown>;
  protoId: string;
  now: string;
}

function prepare(protoId: string, buf: Buffer, topic: string): MessageContext | null {
  const map = MAPPINGS.get(protoId);
  if (!map) {
    console.warn(`protocol-shim: no mapping for prototype id "${protoId}" — skipping`);
    return null;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(buf.toString());
  } catch {
    console.error(`protocol-shim: bad JSON on ${topic}`);
    return null;
  }
  return { map, payload, protoId, now: new Date().toISOString() };
}

// Combined `.../total` dialect. Resolve the device → patient mapping first
// (live: by the MAC in the payload, via the dashboard pairing; otherwise the
// static flag/fixture mapping), then fan one packet out into telemetry / events
// / signals.
async function handleTotalMessage(protoId: string, buf: Buffer, topic: string): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(buf.toString());
  } catch {
    console.error(`protocol-shim: bad JSON on ${topic}`);
    return;
  }

  const mac = normalizeMac(payload.device_mac ?? payload.mac);
  let map: Mapping | undefined;
  let stateKey = protoId;

  if (mac && pairing) {
    // Live path: identity is the device's own MAC, paired to a patient in the
    // dashboard. No hardcoded IDs.
    const resolved = await pairing.resolve(mac);
    if (!resolved) return void warnUnpaired(mac);
    map = resolved;
    stateKey = mac; // latch per physical device, not per (possibly shared) topic id
  } else if (MAPPINGS_EXPLICIT) {
    // Test override: operator passed real UUIDs via --patient-id/--device-id or
    // --map-file. Never used by real hardware.
    map = MAPPINGS.get(protoId);
    if (!map) {
      warnOncePerMin(`map:${protoId}`, `protocol-shim: no --map entry for "${protoId}" — skipping`);
      return;
    }
  } else {
    // Real device we can't pair: say exactly what's missing rather than silently
    // falling back to a hardcoded fixture patient.
    warnOncePerMin(
      `needpair:${topic}`,
      mac == null
        ? `protocol-shim: ${topic} carries no device_mac — firmware must publish its MAC so it can be paired in the dashboard.`
        : `protocol-shim: no SB_SERVICE_KEY to resolve pairing for ${mac} — set a service key so the dashboard pairing can be looked up.`,
    );
    return;
  }

  emitTotal(map, payload, stateKey, new Date().toISOString());
}

// Throttle a warning to at most once per minute per key, so a device publishing
// every couple of seconds doesn't flood the log.
const warnedAt = new Map<string, number>();
function warnOncePerMin(key: string, message: string): void {
  const last = warnedAt.get(key) ?? 0;
  if (Date.now() - last < 60_000) return;
  warnedAt.set(key, Date.now());
  console.warn(message);
}

function warnUnpaired(mac: string): void {
  warnOncePerMin(
    `unpaired:${mac}`,
    `protocol-shim: device ${mac} is not paired — pair it in the dashboard (data starts flowing ` +
      'within ~30s, no restart needed).',
  );
}

function emitTotal(
  map: Mapping,
  payload: Record<string, unknown>,
  stateKey: string,
  now: string,
): void {
  const r = ingestTotal(map, stateFor(stateKey), payload, now);
  state.set(stateKey, r.state);
  for (const e of r.errors) console.error(`protocol-shim: ${e}`);

  if (r.telemetry) {
    publishCanonical(buildTopic(map.patient_id, 'telemetry'), r.telemetry);
    console.log(
      `→ telemetry ${map.patient_id} hr=${r.telemetry.hr_bpm ?? '—'}${r.telemetry.accel ? ' +accel' : ''}`,
    );
  }
  if (r.fall) {
    publishCanonical(buildTopic(map.patient_id, 'events'), r.fall);
    const mr = (r.fall.payload as { movement_rate?: number } | undefined)?.movement_rate;
    console.log(`→ event ${map.patient_id} FALL (movement_rate=${mr})`);
  }
  if (r.attention) {
    publishCanonical(buildTopic(map.patient_id, 'events'), r.attention);
    console.log(`→ event ${map.patient_id} ATTENTION (patient requests attention)`);
  }
  if (r.signals) {
    publishCanonical(buildTopic(map.patient_id, 'signals'), r.signals);
    console.log(
      `→ signals ${map.patient_id} ble=${r.signals.ble.length}${r.signals.gps ? ' +gps' : ''}`,
    );
  }
}

// Per-kind `patient/{id}/raw/*` dialect (prototype / simulator).
function handleRaw(
  kind: string,
  map: Mapping,
  payload: Record<string, unknown>,
  protoId: string,
  now: string,
): void {
  const parsed = { protoId, kind };
  if (parsed.kind === 'heartrate') {
    const r = ingestHeartRate(map, stateFor(parsed.protoId), payload, now);
    state.set(parsed.protoId, r.state);
    if (r.error) return void console.error(`protocol-shim: telemetry rejected — ${r.error}`);
    if (r.telemetry) {
      publishCanonical(buildTopic(map.patient_id, 'telemetry'), r.telemetry);
      console.log(
        `→ telemetry ${map.patient_id} hr=${r.telemetry.hr_bpm}${r.telemetry.accel ? ' +accel' : ''}`,
      );
    }
  } else if (parsed.kind === 'imu') {
    const r = ingestImu(map, stateFor(parsed.protoId), payload, now);
    state.set(parsed.protoId, r.state);
    if (r.error) return void console.error(`protocol-shim: event rejected — ${r.error}`);
    if (r.fall) {
      publishCanonical(buildTopic(map.patient_id, 'events'), r.fall);
      const mr = (r.fall.payload as { movement_rate?: number } | undefined)?.movement_rate;
      console.log(`→ event ${map.patient_id} FALL (movement_rate=${mr})`);
    }
  } else if (parsed.kind === 'location') {
    const r = ingestLocation(map, payload, now, synthByProto.get(parsed.protoId), ALLOW_SYNTH);
    if (r.error) return void console.error(`protocol-shim: signals rejected — ${r.error}`);
    if (r.signals) {
      publishCanonical(buildTopic(map.patient_id, 'signals'), r.signals);
      console.log(`→ signals ${map.patient_id} ble=${r.signals.ble.length}`);
    } else if (r.skipReason && !locationWarned) {
      locationWarned = true;
      console.warn(`protocol-shim: ${r.skipReason}. Skipping signals (warned once).`);
    }
  }
}

// ---- Device provisioning + beacon layout -----------------------------------
// Beacon positions are owned by the SOFTWARE (placed in the dashboard / DB),
// not hardcoded here. We fetch them so location synthesis — and, when real
// hardware arrives, the positioning pipeline — reference the same layout the
// caregiver sees on the map. Falls back to the seed fixture only when no
// service key is available to read them.

async function provisionAndLoadBeacons(): Promise<void> {
  if (!CAN_ENSURE_DEVICE || !sb) {
    console.warn(
      'protocol-shim: no SB_SERVICE_KEY — cannot read placed beacons; location synthesis ' +
        'falls back to the seed fixture layout. Set SB_SERVICE_KEY so the walk maps onto your ' +
        'actual beacon placements.',
    );
    return;
  }
  const supabase = sb;
  for (const [protoId, map] of MAPPINGS) {
    const { error } = await supabase.from('devices').upsert({
      id: map.device_id,
      mac_address: `shim-${map.device_id.slice(0, 12)}`,
      paired_patient_id: map.patient_id,
      last_seen_at: new Date().toISOString(),
      firmware_version: 'shim-1.0.0',
    });
    if (error) fail(`ensure-device for proto "${protoId}" failed: ${error.message}`);
    console.log(`protocol-shim: device ${map.device_id} paired to patient ${map.patient_id}`);

    // Pull the patient's placed beacons + floor-plan scale → synthesis context.
    const { data: beaconRows } = await supabase
      .from('beacons')
      .select('mac_address, x_canvas, y_canvas, rssi_at_1m')
      .eq('patient_id', map.patient_id);
    const { data: plan } = await supabase
      .from('floor_plans')
      .select('scale_meters_per_pixel')
      .eq('patient_id', map.patient_id)
      .eq('is_active', true)
      .maybeSingle();

    const anchors: BeaconAnchor[] = (beaconRows ?? [])
      .filter((b) => b.x_canvas != null && b.y_canvas != null)
      .map(
        (b): BeaconAnchor => ({
          mac: String(b.mac_address),
          x: Number(b.x_canvas),
          y: Number(b.y_canvas),
          rssi1m: b.rssi_at_1m == null ? -65 : Number(b.rssi_at_1m),
        }),
      );
    const scale = Number(
      (plan as { scale_meters_per_pixel?: number } | null)?.scale_meters_per_pixel ?? 0.04,
    );

    if (anchors.length >= 3) {
      synthByProto.set(protoId, { beacons: anchors, scale });
      console.log(
        `protocol-shim: ${anchors.length} placed beacons loaded for ${map.patient_id} ` +
          `(scale ${scale} m/px) — the walk maps onto them`,
      );
    } else {
      console.warn(
        `protocol-shim: only ${anchors.length} placed beacon(s) for ${map.patient_id}; need 3+ ` +
          'to position — falling back to the seed fixture layout.',
      );
    }
  }
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  await provisionAndLoadBeacons();

  client = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD ?? undefined,
    clientId: `protocol-shim-${Date.now()}`,
    reconnectPeriod: 5000,
    keepalive: 30,
  });

  client.on('connect', () => {
    console.log(`protocol-shim: connected ${MQTT_BROKER_URL}`);
    // Two dialects: the per-kind prototype/simulator feed and the real device's
    // combined `.../total` packet.
    const topics = ['patient/+/raw/#', 'alzcare/+/+/total'];
    client.subscribe(topics, { qos: 0 }, (err) => {
      if (err) fail(`subscribe failed: ${err.message}`);
      console.log(
        `protocol-shim: subscribed ${topics.join(', ')} — mapping ${MAPPINGS.size} patient(s): ${[...MAPPINGS.keys()].join(', ')}`,
      );
    });
  });

  client.on('message', onMessage);
  client.on('error', (err) => console.error(`protocol-shim: mqtt error — ${err.message}`));
}

function shutdown(): void {
  if (client) client.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void main();
