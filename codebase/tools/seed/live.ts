// seed:live — the fixed-UUID live-feed test patient.
//
// Creates (idempotently) one patient with the stable UUIDs from
// @alzcare/shared/fixtures, allocated to the admin so it shows in the
// dashboard, with a paired device, floor plan, beacons, and alert rules — the
// minimum for the protocol-shim + a signals sim to light up live data.
//
// Unlike `npm run seed` (5 rich demo patients with random UUIDs + 24h history),
// this seeds exactly one patient with fixed identity so the shim's "001" → UUID
// mapping survives `supabase db reset`.
//
// Prereq: the admin user + their care provider must already exist (sign in once
// via the app, or run `npm run seed`). This script attaches the patient to the
// admin's existing provider.
//
// Usage:
//   SB_SERVICE_KEY=$(supabase status -o env | awk -F= '/SERVICE_ROLE_KEY/{print $2}' | tr -d '"') \
//     npm run seed:live
//
//   # After confirming live data shows, drop the other demo patients:
//   SB_SERVICE_KEY=… npm run seed:live -- --purge-demo

import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  LIVE_TEST_PATIENT_ID,
  LIVE_TEST_DEVICE_ID,
  LIVE_TEST_FLOOR_PLAN_ID,
  LIVE_TEST_SCALE_M_PER_PX,
  LIVE_TEST_BEACONS,
} from '@alzcare/shared/fixtures';

const { values } = parseArgs({
  options: {
    'purge-demo': { type: 'boolean', default: false },
    'allow-non-local': { type: 'boolean', default: false },
  },
});

const URL = process.env.SB_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SB_SERVICE_KEY ?? '';
const ADMIN_EMAIL = 'admin@bizzieapp.com';
const PURGE_DEMO = values['purge-demo'] === true;
const ALLOW_NON_LOCAL = values['allow-non-local'] === true || process.env.ALLOW_NON_LOCAL === '1';

function fail(msg: string): never {
  console.error(`seed:live: ${msg}`);
  process.exit(1);
}

function isLocalUrl(raw: string): boolean {
  try {
    const u = new globalThis.URL(raw);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return false;
  }
}

if (!SERVICE_KEY) fail('SB_SERVICE_KEY env var required (from `supabase status`).');
if (!isLocalUrl(URL) && !ALLOW_NON_LOCAL) {
  fail(`refusing to target non-local URL (${URL}). Set ALLOW_NON_LOCAL=1 to override.`);
}

const admin: SupabaseClient = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Blank starter canvas (same shape as `npm run seed`). The room is delineated
// by the four corner beacons; draw walls in-app via Place → Walls if wanted.
// This MUST be a Fabric-valid document — `{ type: 'wall' }` objects have no
// registered Fabric class, so loadFromJSON throws and the canvas renders
// nothing ("No class registered for wall").
const ROOM_CANVAS = { version: '7.3.1', objects: [], background: 'transparent' };

async function resolveAdmin(): Promise<{ adminId: string; providerId: string }> {
  const list = await admin.auth.admin.listUsers();
  const user = list.data.users.find((u) => u.email === ADMIN_EMAIL);
  if (!user) {
    fail(
      `admin user ${ADMIN_EMAIL} not found — sign in via the app once, or run \`npm run seed\`.`,
    );
  }
  const { data: cg, error } = await admin
    .from('caregivers')
    .select('care_provider_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) fail(`could not read admin caregiver row: ${error.message}`);
  const providerId = (cg as { care_provider_id: string | null } | null)?.care_provider_id;
  if (!providerId) {
    fail('admin has no care provider yet — run `npm run seed` first to bootstrap the tenant.');
  }
  return { adminId: user.id, providerId };
}

async function ensurePatient(providerId: string): Promise<void> {
  const { error } = await admin.from('patients').upsert({
    id: LIVE_TEST_PATIENT_ID,
    full_name: 'Live Feed Test',
    dob: '1950-01-01',
    description: 'Fixed-UUID test patient for the live MQTT feed (protocol-shim + sensor sims).',
    care_provider_id: providerId,
    dementia_stage: 'moderate',
    wandering_risk: 'medium',
  });
  if (error) fail(`patient upsert failed: ${error.message}`);
  console.log(`seed:live: patient ${LIVE_TEST_PATIENT_ID} (Live Feed Test)`);
}

async function ensureAllocation(adminId: string): Promise<void> {
  const { error } = await admin
    .from('caregiver_patient')
    .upsert(
      { caregiver_id: adminId, patient_id: LIVE_TEST_PATIENT_ID },
      { onConflict: 'caregiver_id,patient_id' },
    );
  if (error) fail(`allocation failed: ${error.message}`);
  console.log('seed:live: allocated to admin (shows in dashboard)');
}

async function ensureDevice(): Promise<void> {
  const { error } = await admin.from('devices').upsert({
    id: LIVE_TEST_DEVICE_ID,
    mac_address: 'shim-live-0001',
    firmware_version: 'shim-1.0.0',
    paired_patient_id: LIVE_TEST_PATIENT_ID,
    last_seen_at: new Date().toISOString(),
    label: 'wrist · live test',
  });
  if (error) fail(`device upsert failed: ${error.message}`);
  console.log(`seed:live: device ${LIVE_TEST_DEVICE_ID} paired`);
}

async function ensureFloorPlan(): Promise<void> {
  const { error } = await admin.from('floor_plans').upsert({
    id: LIVE_TEST_FLOOR_PLAN_ID,
    patient_id: LIVE_TEST_PATIENT_ID,
    name: 'Live Test Room',
    canvas_json: ROOM_CANVAS,
    scale_meters_per_pixel: LIVE_TEST_SCALE_M_PER_PX,
  });
  if (error) fail(`floor plan upsert failed: ${error.message}`);
  console.log('seed:live: floor plan');
}

async function ensureBeacons(): Promise<void> {
  const rows = LIVE_TEST_BEACONS.map((b) => ({
    id: b.id,
    patient_id: LIVE_TEST_PATIENT_ID,
    floor_plan_id: LIVE_TEST_FLOOR_PLAN_ID,
    mac_address: b.mac,
    x_canvas: b.x,
    y_canvas: b.y,
    label: b.label,
    tx_power: -59,
    rssi_at_1m: -65,
  }));
  const { error } = await admin.from('beacons').upsert(rows);
  if (error) fail(`beacons upsert failed: ${error.message}`);
  console.log(`seed:live: ${rows.length} beacons (MACs match the signals sim)`);
}

async function ensureAlertRules(): Promise<void> {
  const { count } = await admin
    .from('alert_rules')
    .select('*', { count: 'exact', head: true })
    .eq('patient_id', LIVE_TEST_PATIENT_ID);
  if ((count ?? 0) > 0) {
    console.log('seed:live: alert rules already present');
    return;
  }
  const rules = [
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      type: 'vitals' as const,
      severity: 'warn' as const,
      enabled: true,
      params: { metric: 'hr_bpm', min: 50, max: 110 },
    },
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      type: 'fall' as const,
      severity: 'critical' as const,
      enabled: true,
      params: {},
    },
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      type: 'inactivity' as const,
      severity: 'warn' as const,
      enabled: true,
      params: { inactive_minutes: 30 },
    },
  ];
  const { error } = await admin.from('alert_rules').insert(rules);
  if (error) fail(`alert rules insert failed: ${error.message}`);
  console.log(`seed:live: ${rules.length} alert rules (vitals + fall + inactivity)`);
}

async function purgeDemo(providerId: string): Promise<void> {
  // Delete every other patient in the admin's provider, leaving only the live
  // test patient. FK cascades clear their readings/positions/events/alerts/
  // beacons/floor_plans; paired devices are set null (kept, unpaired).
  const { data, error } = await admin
    .from('patients')
    .delete()
    .eq('care_provider_id', providerId)
    .neq('id', LIVE_TEST_PATIENT_ID)
    .select('id');
  if (error) fail(`purge-demo failed: ${error.message}`);
  console.log(`seed:live: purged ${data?.length ?? 0} other patient(s) from the provider`);
}

async function main(): Promise<void> {
  const { adminId, providerId } = await resolveAdmin();
  await ensurePatient(providerId);
  await ensureAllocation(adminId);
  await ensureDevice();
  await ensureFloorPlan();
  await ensureBeacons();
  await ensureAlertRules();
  if (PURGE_DEMO) await purgeDemo(providerId);

  console.log('\nseed:live done. Sign in at http://localhost:5173 — patient "Live Feed Test".');
  console.log(`  patient_id: ${LIVE_TEST_PATIENT_ID}`);
  console.log(`  device_id:  ${LIVE_TEST_DEVICE_ID}`);
  console.log('  then: npm run shim:start   (defaults to this patient)');
}

main().catch((e) => {
  console.error('seed:live: unexpected error:', e);
  process.exit(1);
});
