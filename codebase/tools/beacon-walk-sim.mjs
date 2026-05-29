// Beacon-walk simulator
// ---------------------------------------------------------------------------
// Publishes a coherent indoor walk as canonical `device/{patient}/signals`,
// with per-beacon RSSI derived from the patient's REAL placed-beacon coords and
// the floor plan's measured metres-per-pixel scale (the inverse of the model
// position_estimator uses), plus a synthetic per-beacon BATTERY %. The estimator
// trilaterates the RSSI into a smooth moving dot; the dashboard's beacon
// diagnostics shows each beacon's live RSSI + battery.
//
// The walk includes random ~10-second STATIONARY intervals (no movement at all),
// so you can see the dot hold still and exercise inactivity behaviour.
//
//   Run from codebase/:   node tools/beacon-walk-sim.mjs [patientId]
//   (defaults to the "Live Feed Test" patient, Jerry Abbott)
//
// Prereqs: ingest running (`npm run stack:up`); creds in apps/edge/.env. Ctrl-C to stop.

import { readFileSync } from 'node:fs';
import mqtt from 'mqtt';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/edge/.env', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const PID = process.argv[2] || '11110000-1111-4111-8111-000000000001'; // default: Jerry Abbott
const DID = '22220000-2222-4222-8222-000000000001';
const TOPIC = `device/${PID}/signals`;
const EXP = 2.0; // DEFAULT_PATH_LOSS_EXPONENT — matches position_estimator
const DEFAULT_RSSI1M = -59; // DEFAULT_RSSI_AT_1M — matches the estimator's null substitute
const PAUSE_MS = 10_000; // stationary interval length
const PAUSE_CHANCE = 0.035; // per-tick chance to begin a stationary interval (~1 per 30s)

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: beacons } = await sb
  .from('beacons')
  .select('mac_address,x_canvas,y_canvas,rssi_at_1m')
  .eq('patient_id', PID);
const placed = (beacons || [])
  .filter((b) => b.x_canvas != null && b.y_canvas != null)
  .map((b) => ({
    mac: String(b.mac_address),
    x: +b.x_canvas,
    y: +b.y_canvas,
    rssi1m: b.rssi_at_1m == null ? DEFAULT_RSSI1M : +b.rssi_at_1m,
  }));
if (placed.length < 3) {
  console.error(`Only ${placed.length} placed beacons for ${PID} — need 3+ to trilaterate.`);
  process.exit(1);
}
const { data: plan } = await sb
  .from('floor_plans')
  .select('scale_meters_per_pixel')
  .eq('patient_id', PID)
  .eq('is_active', true)
  .maybeSingle();
const SCALE = +plan?.scale_meters_per_pixel;
if (!(SCALE > 0)) {
  console.error(
    'Active floor plan has no usable scale_meters_per_pixel — set the scale on the plan first.',
  );
  process.exit(1);
}

const xs = placed.map((b) => b.x),
  ys = placed.map((b) => b.y);
const minX = Math.min(...xs),
  maxX = Math.max(...xs),
  minY = Math.min(...ys),
  maxY = Math.max(...ys);
const cx = (minX + maxX) / 2,
  cy = (minY + maxY) / 2,
  rx = (maxX - minX) * 0.38,
  ry = (maxY - minY) * 0.38;

// Synthetic battery: a varied starting % per beacon (one intentionally low so the
// low-battery colour shows), draining very slowly over the run.
const BAT_BASE = placed.map((_, i) => [92, 74, 48, 16][i % 4]);
const battery = (i, n) => Math.max(5, BAT_BASE[i] - n * 0.02);
const voltage = (pct) => +(3.3 + (pct / 100) * (4.2 - 3.3)).toFixed(2);

console.log(`Beacon-walk sim → ${TOPIC}`);
console.log(
  `${placed.length} beacons · scale ${SCALE} m/px · walk area ≈ ${((maxX - minX) * SCALE).toFixed(1)} × ${((maxY - minY) * SCALE).toFixed(1)} m`,
);
console.log(`battery start %: [${BAT_BASE.join(', ')}] · random 10s stationary intervals enabled`);

const rssiFor = (b, px, py) => {
  const distM = Math.max(Math.hypot(px - b.x, py - b.y) * SCALE, 0.5);
  return Math.round(Math.max(-99, Math.min(-40, b.rssi1m - 10 * EXP * Math.log10(distM))));
};

const c = mqtt.connect(env.MQTT_BROKER_URL, {
  username: env.MQTT_USERNAME,
  password: env.MQTT_PASSWORD,
  reconnectPeriod: 2000,
});
let theta = 0,
  n = 0,
  paused = false,
  pauseUntil = 0;

function tick() {
  const now = Date.now();
  if (paused && now >= pauseUntil) paused = false;
  if (!paused && Math.random() < PAUSE_CHANCE) {
    paused = true;
    pauseUntil = now + PAUSE_MS;
    console.log(`⏸  stationary for ${PAUSE_MS / 1000}s (no movement)`);
  }
  if (!paused) theta += 0.18; // frozen while paused ⇒ position holds, RSSI constant
  const px = cx + rx * Math.cos(theta),
    py = cy + ry * Math.sin(theta);
  const ble = placed.map((b, i) => {
    const pct = Math.round(battery(i, n));
    return { mac: b.mac, rssi: rssiFor(b, px, py), battery_pct: pct, voltage: voltage(pct) };
  });
  c.publish(
    TOPIC,
    JSON.stringify({
      v: 1,
      patient_id: PID,
      device_id: DID,
      recorded_at: new Date().toISOString(),
      ble,
      wifi: [],
    }),
    { qos: 0 },
  );
  if (++n % 5 === 1) {
    console.log(
      `tick ${n} ${paused ? '[STILL]' : '[walk]'} pos=(${px.toFixed(0)},${py.toFixed(0)}) rssi=[${ble.map((b) => b.rssi).join(', ')}] bat=[${ble.map((b) => b.battery_pct).join(', ')}]`,
    );
  }
}
c.on('connect', () => {
  console.log('connected; publishing 1 Hz (Ctrl-C to stop)');
  tick();
  setInterval(tick, 1000);
});
c.on('error', (e) => console.error('mqtt error', e.message));
process.on('SIGINT', () => {
  c.end(true);
  process.exit(0);
});
