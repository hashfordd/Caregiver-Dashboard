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
    'demo-data': { type: 'boolean', default: false },
    'allow-non-local': { type: 'boolean', default: false },
  },
});

const URL = process.env.SB_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SB_SERVICE_KEY ?? '';
const ADMIN_EMAIL = 'admin@bizzieapp.com';
const PURGE_DEMO = values['purge-demo'] === true;
const DEMO_DATA = values['demo-data'] === true;
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
    full_name: 'Jerry Abbott',
    dob: '1950-01-01',
    description: 'Fixed-UUID patient for the live MQTT feed (protocol-shim + sensor sims).',
    care_provider_id: providerId,
    dementia_stage: 'moderate',
    wandering_risk: 'medium',
  });
  if (error) fail(`patient upsert failed: ${error.message}`);
  console.log(`seed:live: patient ${LIVE_TEST_PATIENT_ID} (Jerry Abbott)`);
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

async function purgeDemo(adminId: string): Promise<void> {
  // Delete every other patient on the admin's roster, leaving only the live
  // test patient — scoped to caregiver_patient so it catches demo patients
  // seeded under a different care_provider too. FK cascades clear their
  // readings/positions/events/alerts/beacons/floor_plans; paired devices are
  // set null (kept, unpaired).
  const { data: roster, error: rosterErr } = await admin
    .from('caregiver_patient')
    .select('patient_id')
    .eq('caregiver_id', adminId)
    .neq('patient_id', LIVE_TEST_PATIENT_ID);
  if (rosterErr) fail(`purge-demo roster lookup failed: ${rosterErr.message}`);

  const ids = (roster ?? []).map((r) => (r as { patient_id: string }).patient_id);
  if (ids.length === 0) {
    console.log('seed:live: no other patients to purge');
    return;
  }

  const { data, error } = await admin.from('patients').delete().in('id', ids).select('id');
  if (error) fail(`purge-demo failed: ${error.message}`);
  console.log(`seed:live: purged ${data?.length ?? 0} other patient(s) from the roster`);
}

// ──────────────────────────────────────────────────────────────────────────
// --demo-data: populate Jerry's care surfaces (care plan, meds, notes, alerts,
// incidents) so the non-telemetry tabs aren't empty. All idempotent — guarded
// by a presence check so re-runs don't pile up duplicates.
// ──────────────────────────────────────────────────────────────────────────

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const isoAgo = (ms: number): string => new Date(Date.now() - ms).toISOString();

async function ensureCarePlan(): Promise<void> {
  const { error } = await admin
    .from('patients')
    .update({
      care_plan_summary:
        "Moderate-stage Alzheimer's. Independent with prompting; mobilises with a walking " +
        'frame. Prone to late-afternoon agitation (sundowning) — redirect with tea, familiar ' +
        'music and the photo album. Settles well overnight. Escort on walks; medium wandering risk.',
      known_triggers: [
        'loud noises',
        'late-afternoon (sundowning)',
        'unfamiliar faces',
        'crowded rooms',
      ],
      preferences: {
        wake_time: '06:30',
        bed_time: '20:30',
        favourite_music: 'jazz standards',
        tea: 'white, one sugar',
        mobility_aid: 'walking frame',
        calming_routine: 'photo album + radio',
      },
    })
    .eq('id', LIVE_TEST_PATIENT_ID);
  if (error) fail(`care plan update failed: ${error.message}`);
  console.log('seed:live: care plan summary + triggers + preferences');
}

async function ensureMedications(adminId: string): Promise<void> {
  const { count } = await admin
    .from('medications')
    .select('*', { count: 'exact', head: true })
    .eq('patient_id', LIVE_TEST_PATIENT_ID);
  if ((count ?? 0) > 0) {
    console.log('seed:live: medications already present');
    return;
  }

  const tz = 'Australia/Melbourne';
  const meds = [
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      name: 'Donepezil',
      dose: '10 mg',
      route: 'oral',
      schedule: { times: ['08:00'], tz },
      prn: false,
      active: true,
      notes: 'Cognition. Take with breakfast.',
    },
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      name: 'Memantine',
      dose: '10 mg',
      route: 'oral',
      schedule: { times: ['08:00', '20:00'], tz },
      prn: false,
      active: true,
      notes: 'Cognition.',
    },
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      name: 'Sertraline',
      dose: '50 mg',
      route: 'oral',
      schedule: { times: ['08:00'], tz },
      prn: false,
      active: true,
      notes: 'Mood / anxiety.',
    },
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      name: 'Paracetamol',
      dose: '500 mg',
      route: 'oral',
      schedule: null,
      prn: true,
      active: true,
      notes: 'PRN for arthritis pain. Max 4 g / 24 h.',
    },
  ];
  const { data, error } = await admin.from('medications').insert(meds).select('id, name');
  if (error) fail(`medications insert failed: ${error.message}`);
  console.log(`seed:live: ${data?.length ?? 0} medications`);

  // A little administration history so the Meds tab shows a dose log.
  const byName = new Map(
    (data ?? []).map((m) => [(m as { name: string }).name, (m as { id: string }).id]),
  );
  const admins: Array<{
    medication_id: string;
    scheduled_for: string;
    administered_at: string | null;
    administered_by: string | null;
    status: string;
    notes: string | null;
  }> = [];
  const give = (
    name: string,
    schedAgo: number,
    status = 'given',
    note: string | null = null,
  ): void => {
    const id = byName.get(name);
    if (!id) return;
    admins.push({
      medication_id: id,
      scheduled_for: isoAgo(schedAgo),
      administered_at: status === 'given' ? isoAgo(schedAgo - 5 * 60 * 1000) : null,
      administered_by: status === 'given' ? adminId : null,
      status,
      notes: note,
    });
  };
  // Yesterday's doses, then this morning's.
  give('Donepezil', DAY + 4 * HOUR);
  give('Memantine', DAY + 4 * HOUR);
  give('Memantine', DAY - 8 * HOUR); // evening dose
  give(
    'Sertraline',
    DAY + 4 * HOUR,
    'refused',
    'Declined — spat out. Re-offered 30 min later, took it.',
  );
  give('Donepezil', 4 * HOUR);
  give('Memantine', 4 * HOUR);
  give('Sertraline', 4 * HOUR);
  if (admins.length > 0) {
    const { error: aErr } = await admin.from('medication_administrations').insert(admins);
    if (aErr) console.warn(`seed:live: med administrations failed: ${aErr.message}`);
    else console.log(`seed:live: ${admins.length} medication administrations`);
  }
}

async function ensureNotes(adminId: string): Promise<void> {
  const { count } = await admin
    .from('patient_notes')
    .select('*', { count: 'exact', head: true })
    .eq('patient_id', LIVE_TEST_PATIENT_ID);
  if ((count ?? 0) > 0) {
    console.log('seed:live: notes already present');
    return;
  }
  const notes = [
    {
      body: 'Settled overnight, slept through. Full breakfast and took morning meds without fuss. Joined the music group and was calm and engaged.',
      created_at: isoAgo(3 * DAY),
    },
    {
      body: 'Mild sundowning around 16:00 — pacing near the front door. Redirected with a cup of tea and the photo album; settled within ten minutes. No agitation afterwards.',
      created_at: isoAgo(2 * DAY),
    },
    {
      body: 'Daughter visited this afternoon and brought new family photos. Mood lifted noticeably; recognised her without prompting. Walking frame is steady — no unsteadiness on the corridor walk.',
      created_at: isoAgo(20 * HOUR),
    },
    {
      body: 'Complained of knee pain this morning; given PRN paracetamol with good effect. Encourage gentle movement, avoid long periods seated.',
      created_at: isoAgo(5 * HOUR),
    },
  ].map((n) => ({
    patient_id: LIVE_TEST_PATIENT_ID,
    author_caregiver_id: adminId,
    body: n.body,
    created_at: n.created_at,
  }));
  const { error } = await admin.from('patient_notes').insert(notes);
  if (error) fail(`notes insert failed: ${error.message}`);
  console.log(`seed:live: ${notes.length} notes`);
}

async function ensureSampleAlerts(adminId: string): Promise<void> {
  const { count } = await admin
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('patient_id', LIVE_TEST_PATIENT_ID);
  if ((count ?? 0) > 0) {
    console.log('seed:live: alerts already present');
    return;
  }
  const { data: rules } = await admin
    .from('alert_rules')
    .select('id, type, severity')
    .eq('patient_id', LIVE_TEST_PATIENT_ID);
  const ruleByType = new Map(
    ((rules ?? []) as Array<{ id: string; type: string; severity: string }>).map((r) => [
      r.type,
      r,
    ]),
  );

  const alerts: Array<Record<string, unknown>> = [];
  const add = (
    type: string,
    hoursAgo: number,
    acked: boolean,
    context: Record<string, unknown>,
    severity?: string,
  ): void => {
    const rule = ruleByType.get(type);
    if (!rule) return;
    const firedAt = new Date(Date.now() - hoursAgo * HOUR);
    alerts.push({
      patient_id: LIVE_TEST_PATIENT_ID,
      rule_id: rule.id,
      severity: severity ?? rule.severity,
      fired_at: firedAt.toISOString(),
      acknowledged_at: acked ? new Date(firedAt.getTime() + 5 * 60 * 1000).toISOString() : null,
      ack_by_caregiver_id: acked ? adminId : null,
      context,
    });
  };
  add('vitals', 18, true, {
    kind: 'vitals',
    metric: 'hr_bpm',
    value: 122,
    min: 50,
    max: 110,
    breached: 'high',
  });
  add('inactivity', 12, true, {
    kind: 'inactivity',
    inactive_minutes: 30,
    observed_inactive_seconds: 2400,
  });
  add('vitals', 1.5, false, {
    kind: 'vitals',
    metric: 'spo2_pct',
    value: 91,
    min: 92,
    max: null,
    breached: 'low',
  });
  add('fall', 0.4, false, { kind: 'fall', payload: { movement_rate: 2.4, axis: 'z' } });

  if (alerts.length === 0) {
    console.log('seed:live: no alert rules to attach sample alerts to');
    return;
  }
  const { error } = await admin.from('alerts').insert(alerts);
  if (error) fail(`sample alerts insert failed: ${error.message}`);
  console.log(`seed:live: ${alerts.length} sample alerts (2 acked, 2 unacked)`);
}

async function ensureIncidents(adminId: string): Promise<void> {
  const { count } = await admin
    .from('incidents')
    .select('*', { count: 'exact', head: true })
    .eq('patient_id', LIVE_TEST_PATIENT_ID);
  if ((count ?? 0) > 0) {
    console.log('seed:live: incidents already present');
    return;
  }
  const incidents = [
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      logged_by: adminId,
      occurred_at: isoAgo(6 * DAY),
      type: 'fall',
      severity: 2,
      description:
        'Slipped getting out of the armchair in the lounge. No loss of consciousness, no visible injury. Obs taken, GP notified. Walking frame placed within reach.',
      follow_up_required: false,
      resolved_at: isoAgo(6 * DAY - 2 * HOUR),
    },
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      logged_by: adminId,
      occurred_at: isoAgo(2 * DAY),
      type: 'agitation',
      severity: 1,
      description:
        'Sundowning episode ~16:00, pacing and calling for "home". Redirected with tea and photo album; settled in ~10 min. Recommend earlier afternoon activity.',
      follow_up_required: true,
      resolved_at: null,
    },
    {
      patient_id: LIVE_TEST_PATIENT_ID,
      logged_by: adminId,
      occurred_at: isoAgo(22 * HOUR),
      type: 'wander',
      severity: 2,
      description:
        'Found at the front entrance attempting to leave after lunch. Door alarm triggered, staff redirected without distress. Review exit supervision over the lunch period.',
      follow_up_required: false,
      resolved_at: isoAgo(21 * HOUR),
    },
  ];
  const { error } = await admin.from('incidents').insert(incidents);
  if (error) fail(`incidents insert failed: ${error.message}`);
  console.log(`seed:live: ${incidents.length} incidents`);
}

async function seedDemoData(adminId: string): Promise<void> {
  await ensureCarePlan();
  await ensureMedications(adminId);
  await ensureNotes(adminId);
  await ensureSampleAlerts(adminId);
  await ensureIncidents(adminId);
}

async function main(): Promise<void> {
  const { adminId, providerId } = await resolveAdmin();
  await ensurePatient(providerId);
  await ensureAllocation(adminId);
  await ensureDevice();
  await ensureFloorPlan();
  await ensureBeacons();
  await ensureAlertRules();
  if (PURGE_DEMO) await purgeDemo(adminId);
  if (DEMO_DATA) await seedDemoData(adminId);

  console.log('\nseed:live done. Sign in at http://localhost:5173 — patient "Jerry Abbott".');
  console.log(`  patient_id: ${LIVE_TEST_PATIENT_ID}`);
  console.log(`  device_id:  ${LIVE_TEST_DEVICE_ID}`);
  console.log('  then: npm run shim:start   (defaults to this patient)');
}

main().catch((e) => {
  console.error('seed:live: unexpected error:', e);
  process.exit(1);
});
