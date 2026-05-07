// Idempotent rich demo seed for the Phase 5 dry-run, demo script, and
// TST-10 continuous-run test plan.
//
// Stage by stage, every step is a "skip if already present" guard so the
// script is safe to re-run repeatedly. Stages:
//
//   1.  admin user @ admin@bizzieapp.com (creates if absent; normalises
//       full_name + company_name on every run).
//   2.  the admin's care_provider row (post-Phase B). If the admin has
//       no provider yet, calls create_care_provider so they end up admin
//       of "Riverside Care Network".
//   3.  five demo patients allocated to the admin via
//       create_patient_with_allocation.
//   4.  one paired device per patient via the pair_device RPC.
//   5.  one starter "Home" floor plan per patient (empty Fabric canvas
//       + 0.02 m/px scale).
//   6.  four beacons per patient placed at room corners.
//   7.  six calibration points per patient scattered through the room.
//   8.  one alert rule of each type per patient (vitals / inactivity /
//       fall / indoor zone).
//   9.  twenty-four hours of synthetic sensor + position history per
//       patient — sampled 1/min for vitals and 1/30s for positions, with
//       a short outdoor excursion mid-window so the map view has data.
//   10. five sample alerts per patient (mix of severities; three acked,
//       two unacked) so the bell + history surface have content.
//
// Each stage logs a one-line summary so a re-run produces a tidy
// inventory rather than spammy noise.
//
// Usage:
//   SB_SERVICE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2) \
//     npm run seed
//
// To target the hosted dev project (not local):
//   SB_URL=https://lchalkfkqftpxglgzkct.supabase.co \
//   SB_ANON_KEY=<publishable key> \
//   SB_SERVICE_KEY=<service role key> \
//     npm run seed

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SB_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SB_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SB_SERVICE_KEY ?? '';

const ADMIN_EMAIL = 'admin@bizzieapp.com';
const ADMIN_PASSWORD = 'DemoPass123!';
const ADMIN_FULL_NAME = 'Harrison Ashford';
const ADMIN_COMPANY = 'Riverside Care Network';

if (!SERVICE_KEY) {
  console.error(
    'seed: SB_SERVICE_KEY env var required (the service-role key from `supabase status`).',
  );
  process.exit(2);
}

// Phase H item 70: refuse to target a non-local URL by default. The
// rich seed inserts ~22k rows (24 h × 5 patients of sensor + position
// history, plus alert rules + sample alerts) — pointing it at prod by
// accident is destructive. Set ALLOW_NON_LOCAL=1 to override for the
// hosted dev project.
function isLocalUrl(raw: string): boolean {
  try {
    // `URL` is shadowed in this file by the SB_URL constant; resolve
    // the global constructor explicitly.
    const u = new globalThis.URL(raw);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return false;
  }
}
if (!isLocalUrl(URL) && process.env.ALLOW_NON_LOCAL !== '1') {
  console.error(
    `seed: refusing to seed non-local URL (${URL}). Set ALLOW_NON_LOCAL=1 to override.`,
  );
  process.exit(2);
}

const admin: SupabaseClient = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface PatientSpec {
  full_name: string;
  dob: string;
  description: string;
  deviceLabel: string;
  vitalsProfile: { hr: [number, number]; spo2: [number, number]; temp: [number, number] };
}

const PATIENTS: PatientSpec[] = [
  {
    full_name: 'Margaret Holloway',
    dob: '1947-03-12',
    description:
      "Mid-stage Alzheimer's. Lives at home with her daughter; carer visits twice weekly. Wandering risk after dusk.",
    deviceLabel: 'wrist · left',
    vitalsProfile: { hr: [68, 88], spo2: [95, 98], temp: [36.4, 36.9] },
  },
  {
    full_name: "James O'Connor",
    dob: '1942-08-30',
    description:
      'Recent diagnosis. Active and ambulatory; walks the garden twice daily. Watch for fall risk on stairs.',
    deviceLabel: 'wrist · right',
    vitalsProfile: { hr: [72, 92], spo2: [96, 99], temp: [36.5, 37.1] },
  },
  {
    full_name: 'Eleanor Tanaka',
    dob: '1951-11-04',
    description:
      'Late-stage care. Mostly bedridden; SpO₂ historically dips overnight — escalate below 92%.',
    deviceLabel: 'wrist · left',
    vitalsProfile: { hr: [60, 76], spo2: [92, 96], temp: [36.2, 36.7] },
  },
  {
    full_name: 'Bernard Whitfield',
    dob: '1939-06-21',
    description:
      'Vascular dementia. Uses a walker indoors; physiotherapy appointments Tue/Thu mornings.',
    deviceLabel: 'wrist · right',
    vitalsProfile: { hr: [65, 82], spo2: [94, 97], temp: [36.3, 36.8] },
  },
  {
    full_name: 'Aroha Nguyen',
    dob: '1955-02-09',
    description:
      "Early-stage Alzheimer's. Independent on most ADLs. Daughter is the secondary contact.",
    deviceLabel: 'ankle',
    vitalsProfile: { hr: [70, 90], spo2: [96, 99], temp: [36.5, 37.0] },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function fail(msg: string): never {
  console.error(`seed: ${msg}`);
  process.exit(1);
}

function randomMac(): string {
  const hex = (): string =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
}

function pickInRange(range: readonly [number, number]): number {
  const lo = range[0];
  const hi = range[1];
  return lo + Math.random() * (hi - lo);
}

function jitter(value: number, fraction: number): number {
  return value * (1 - fraction + Math.random() * 2 * fraction);
}

// Empty Fabric canvas — round-trips cleanly through loadFromJSON. The
// editor renders an empty board and the empty-state copy is skipped
// because a row exists in floor_plans.
const STARTER_CANVAS_JSON = { version: '7.3.1', objects: [], background: 'transparent' };
// 1px = 2cm. A 6m × 8m room is therefore 300 × 400 px.
const STARTER_SCALE_M_PER_PX = 0.02;
const ROOM_WIDTH_PX = 300;
const ROOM_HEIGHT_PX = 400;

// ──────────────────────────────────────────────────────────────────────────
// 1. admin user
// ──────────────────────────────────────────────────────────────────────────

async function ensureAdmin(): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: ADMIN_FULL_NAME,
      role: 'professional',
      company_name: ADMIN_COMPANY,
    },
  });
  if (created.data.user) {
    console.log(`seed: created admin user ${ADMIN_EMAIL} (${created.data.user.id})`);
    return created.data.user.id;
  }
  const list = await admin.auth.admin.listUsers();
  const existing = list.data.users.find((u) => u.email === ADMIN_EMAIL);
  if (existing) {
    console.log(`seed: admin user ${ADMIN_EMAIL} already present (${existing.id})`);
    return existing.id;
  }
  fail(`could not find or create admin user: ${created.error?.message ?? 'unknown'}`);
}

async function normaliseAdminProfile(adminId: string): Promise<void> {
  const { error } = await admin
    .from('caregivers')
    .update({ full_name: ADMIN_FULL_NAME, company_name: ADMIN_COMPANY })
    .eq('id', adminId);
  if (error) console.warn(`seed: could not update admin profile: ${error.message}`);
  else console.log(`seed: admin profile normalised (${ADMIN_FULL_NAME} · ${ADMIN_COMPANY})`);
}

// ──────────────────────────────────────────────────────────────────────────
// 2. provider tenancy bootstrap
// ──────────────────────────────────────────────────────────────────────────

async function ensureAdminProvider(adminId: string, userClient: SupabaseClient): Promise<string> {
  const { data: row } = await admin
    .from('caregivers')
    .select('care_provider_id')
    .eq('id', adminId)
    .maybeSingle();
  const existing = (row as { care_provider_id: string | null } | null)?.care_provider_id ?? null;
  if (existing) {
    // Make sure they're admin of it (Phase B backfill leaves them admin).
    await admin.from('caregivers').update({ provider_role: 'admin' }).eq('id', adminId);
    console.log(`seed: admin provider already bound (${existing})`);
    return existing;
  }
  // Use the user-scoped client so create_care_provider attributes the
  // caller correctly.
  const { data, error } = await userClient.rpc('create_care_provider', { p_name: ADMIN_COMPANY });
  if (error || !data) fail(`create_care_provider failed: ${error?.message ?? 'no data'}`);
  const provider = data as { id: string; name: string };
  console.log(`seed: created care provider ${provider.name} (${provider.id})`);
  return provider.id;
}

// ──────────────────────────────────────────────────────────────────────────
// 3 + 4. patients + devices
// ──────────────────────────────────────────────────────────────────────────

interface PatientRow {
  id: string;
  full_name: string;
  spec: PatientSpec;
}

async function ensurePatients(adminId: string, userClient: SupabaseClient): Promise<PatientRow[]> {
  // Admin's existing allocations.
  const { data: allocs } = await admin
    .from('caregiver_patient')
    .select('patient_id, patients!inner(id, full_name)')
    .eq('caregiver_id', adminId);
  const present = new Map<string, { id: string; full_name: string }>();
  for (const row of (allocs ?? []) as unknown as Array<{
    patient_id: string;
    patients: { id: string; full_name: string };
  }>) {
    present.set(row.patients.full_name, { id: row.patients.id, full_name: row.patients.full_name });
  }

  const out: PatientRow[] = [];
  for (const spec of PATIENTS) {
    const existing = present.get(spec.full_name);
    if (existing) {
      out.push({ ...existing, spec });
      continue;
    }
    const { data, error } = await userClient.rpc('create_patient_with_allocation', {
      p_full_name: spec.full_name,
      p_dob: spec.dob,
      p_description: spec.description,
    });
    if (error || !data) {
      console.warn(`seed: create_patient ${spec.full_name} failed: ${error?.message ?? 'no data'}`);
      continue;
    }
    const created = data as { id: string; full_name: string };
    console.log(`seed: created patient ${created.full_name} (${created.id})`);
    out.push({ id: created.id, full_name: created.full_name, spec });
  }
  return out;
}

async function ensureDevicesForPatients(
  patients: PatientRow[],
  userClient: SupabaseClient,
): Promise<Map<string, string>> {
  const deviceByPatient = new Map<string, string>();
  for (const p of patients) {
    const { data: existing } = await admin
      .from('devices')
      .select('id')
      .eq('paired_patient_id', p.id)
      .limit(1)
      .maybeSingle();
    if (existing && (existing as { id: string }).id) {
      deviceByPatient.set(p.id, (existing as { id: string }).id);
      continue;
    }
    const mac = randomMac();
    const { data, error } = await userClient.rpc('pair_device', {
      p_mac_address: mac,
      p_patient_id: p.id,
      p_label: p.spec.deviceLabel,
    });
    if (error || !data) {
      console.warn(`seed: pair_device ${p.full_name} failed: ${error?.message ?? 'no data'}`);
      continue;
    }
    const device = data as { id: string };
    deviceByPatient.set(p.id, device.id);
    console.log(`seed: paired device ${mac} to ${p.full_name}`);
  }
  return deviceByPatient;
}

// ──────────────────────────────────────────────────────────────────────────
// 5. floor plans
// ──────────────────────────────────────────────────────────────────────────

async function ensureFloorPlans(patients: PatientRow[]): Promise<Map<string, string>> {
  const planByPatient = new Map<string, string>();
  for (const p of patients) {
    const { data: existing } = await admin
      .from('floor_plans')
      .select('id')
      .eq('patient_id', p.id)
      .limit(1)
      .maybeSingle();
    if (existing && (existing as { id: string }).id) {
      planByPatient.set(p.id, (existing as { id: string }).id);
      continue;
    }
    const { data, error } = await admin
      .from('floor_plans')
      .insert({
        patient_id: p.id,
        name: 'Home',
        canvas_json: STARTER_CANVAS_JSON,
        scale_meters_per_pixel: STARTER_SCALE_M_PER_PX,
      })
      .select('id')
      .single();
    if (error || !data) {
      console.warn(`seed: floor_plan ${p.full_name} failed: ${error?.message ?? 'no data'}`);
      continue;
    }
    planByPatient.set(p.id, (data as { id: string }).id);
    console.log(`seed: floor plan created for ${p.full_name}`);
  }
  return planByPatient;
}

// ──────────────────────────────────────────────────────────────────────────
// 6. beacons (4 per patient at room corners)
// ──────────────────────────────────────────────────────────────────────────

async function ensureBeacons(patients: PatientRow[], plans: Map<string, string>): Promise<void> {
  for (const p of patients) {
    const planId = plans.get(p.id);
    if (!planId) continue;
    const { count } = await admin
      .from('beacons')
      .select('*', { count: 'exact', head: true })
      .eq('patient_id', p.id);
    if ((count ?? 0) >= 4) continue;

    const corners: Array<[string, number, number]> = [
      ['NW', 10, 10],
      ['NE', ROOM_WIDTH_PX - 10, 10],
      ['SE', ROOM_WIDTH_PX - 10, ROOM_HEIGHT_PX - 10],
      ['SW', 10, ROOM_HEIGHT_PX - 10],
    ];
    const rows = corners.map(([label, x, y]) => ({
      patient_id: p.id,
      floor_plan_id: planId,
      mac_address: randomMac(),
      x_canvas: x,
      y_canvas: y,
      label,
      tx_power: -59,
      rssi_at_1m: -65,
    }));
    const { error } = await admin.from('beacons').insert(rows);
    if (error) {
      console.warn(`seed: beacons for ${p.full_name} failed: ${error.message}`);
      continue;
    }
    console.log(`seed: 4 beacons placed for ${p.full_name}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 7. calibration points (6 per patient)
// ──────────────────────────────────────────────────────────────────────────

async function ensureCalibrationPoints(
  patients: PatientRow[],
  plans: Map<string, string>,
): Promise<void> {
  for (const p of patients) {
    const planId = plans.get(p.id);
    if (!planId) continue;
    const { count } = await admin
      .from('calibration_points')
      .select('*', { count: 'exact', head: true })
      .eq('floor_plan_id', planId);
    if ((count ?? 0) >= 6) continue;

    const points: Array<[number, number]> = [
      [60, 60],
      [150, 60],
      [240, 60],
      [60, 200],
      [150, 200],
      [240, 340],
    ];
    const rows = points.map(([x, y]) => ({
      floor_plan_id: planId,
      x_canvas: x,
      y_canvas: y,
      ble_signature: [
        { mac: 'aa:00:00:00:00:01', rssi_mean: -55 - Math.random() * 15, samples: 30 },
        { mac: 'aa:00:00:00:00:02', rssi_mean: -65 - Math.random() * 15, samples: 30 },
      ],
      wifi_signature: [],
    }));
    const { error } = await admin.from('calibration_points').insert(rows);
    if (error) {
      console.warn(`seed: calibration for ${p.full_name} failed: ${error.message}`);
      continue;
    }
    console.log(`seed: 6 calibration points for ${p.full_name}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 8. alert rules (4 per patient — vitals + inactivity + fall + indoor zone)
// ──────────────────────────────────────────────────────────────────────────

async function ensureAlertRules(patients: PatientRow[]): Promise<void> {
  for (const p of patients) {
    const { count } = await admin
      .from('alert_rules')
      .select('*', { count: 'exact', head: true })
      .eq('patient_id', p.id);
    if ((count ?? 0) > 0) continue;

    const rules = [
      {
        patient_id: p.id,
        type: 'vitals' as const,
        severity: 'warn' as const,
        enabled: true,
        params: { metric: 'hr_bpm', min: 50, max: 110 },
      },
      {
        patient_id: p.id,
        type: 'inactivity' as const,
        severity: 'warn' as const,
        enabled: true,
        params: { inactive_minutes: 30 },
      },
      {
        patient_id: p.id,
        type: 'fall' as const,
        severity: 'critical' as const,
        enabled: true,
        params: {},
      },
      {
        patient_id: p.id,
        type: 'zone' as const,
        severity: 'warn' as const,
        enabled: true,
        params: {
          space: 'indoor',
          // Bed area: top-right quadrant of the room.
          polygon: [
            [180, 30],
            [280, 30],
            [280, 130],
            [180, 130],
          ],
          direction: 'exit',
          dwell_seconds: 0,
        },
      },
    ];
    const { error } = await admin.from('alert_rules').insert(rules);
    if (error) {
      console.warn(`seed: alert_rules for ${p.full_name} failed: ${error.message}`);
      continue;
    }
    console.log(`seed: 4 alert rules for ${p.full_name}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 9. 24h synthetic sensor + position history
// ──────────────────────────────────────────────────────────────────────────

const HISTORY_HOURS = 24;
const SENSOR_INTERVAL_S = 60; // 1/min ⇒ 1440 rows/patient/24h
const POSITION_INTERVAL_S = 30; // 1/30s ⇒ 2880 rows/patient/24h

async function ensureSensorHistory(
  patients: PatientRow[],
  devicesByPatient: Map<string, string>,
): Promise<void> {
  for (const p of patients) {
    const deviceId = devicesByPatient.get(p.id);
    if (!deviceId) continue;
    const { count } = await admin
      .from('sensor_readings')
      .select('*', { count: 'exact', head: true })
      .eq('patient_id', p.id);
    // Skip if there's already substantial history (not just the legacy
    // 5-min slice from the pre-Phase-D seed).
    if ((count ?? 0) >= 1000) continue;

    const totalSeconds = HISTORY_HOURS * 3600;
    const samples = Math.floor(totalSeconds / SENSOR_INTERVAL_S);
    const baseTime = Date.now();
    const rows = Array.from({ length: samples }, (_, i) => ({
      patient_id: p.id,
      device_id: deviceId,
      recorded_at: new Date(baseTime - i * SENSOR_INTERVAL_S * 1000).toISOString(),
      hr_bpm: Math.round(pickInRange(p.spec.vitalsProfile.hr)),
      spo2_pct: Math.round(pickInRange(p.spec.vitalsProfile.spo2) * 10) / 10,
      temp_c: Math.round(pickInRange(p.spec.vitalsProfile.temp) * 10) / 10,
    }));
    // Insert in chunks to keep payloads modest.
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await admin.from('sensor_readings').insert(chunk);
      if (error) {
        console.warn(`seed: sensor history for ${p.full_name} failed: ${error.message}`);
        break;
      }
    }
    console.log(`seed: ${samples} sensor readings for ${p.full_name} (24 h × 1/min)`);
  }
}

async function ensurePositionHistory(patients: PatientRow[]): Promise<void> {
  for (const p of patients) {
    const { count } = await admin
      .from('position_estimates')
      .select('*', { count: 'exact', head: true })
      .eq('patient_id', p.id);
    if ((count ?? 0) >= 1000) continue;

    const totalSeconds = HISTORY_HOURS * 3600;
    const samples = Math.floor(totalSeconds / POSITION_INTERVAL_S);
    const baseTime = Date.now();

    // Indoor random walk inside the room with a 90-min outdoor excursion
    // 6 hours into the past (so demo viewers see both modes on the
    // history scrubber).
    const OUTDOOR_START = 6 * 3600; // seconds ago
    const OUTDOOR_END = 7.5 * 3600;
    let x = ROOM_WIDTH_PX / 2;
    let y = ROOM_HEIGHT_PX / 2;

    const rows = Array.from({ length: samples }, (_, i) => {
      const secondsAgo = i * POSITION_INTERVAL_S;
      const isOutdoor = secondsAgo > OUTDOOR_START && secondsAgo < OUTDOOR_END;
      // Random-walk the indoor coords (clamped to room bounds).
      x = Math.max(15, Math.min(ROOM_WIDTH_PX - 15, x + (Math.random() - 0.5) * 10));
      y = Math.max(15, Math.min(ROOM_HEIGHT_PX - 15, y + (Math.random() - 0.5) * 10));

      if (isOutdoor) {
        // Pretend they walked to the corner shop in Hawthorn (Melbourne).
        const lat = -37.8217 + (Math.random() - 0.5) * 0.002;
        const lng = 145.0273 + (Math.random() - 0.5) * 0.002;
        return {
          patient_id: p.id,
          recorded_at: new Date(baseTime - secondsAgo * 1000).toISOString(),
          mode: 'outdoor' as const,
          x_canvas: null,
          y_canvas: null,
          lat: Math.round(lat * 1e6) / 1e6,
          lng: Math.round(lng * 1e6) / 1e6,
          confidence: 0.7 + Math.random() * 0.2,
          gps_strong: true,
          indoor_confidence: null,
        };
      }
      return {
        patient_id: p.id,
        recorded_at: new Date(baseTime - secondsAgo * 1000).toISOString(),
        mode: 'indoor' as const,
        x_canvas: Math.round(x),
        y_canvas: Math.round(y),
        lat: null,
        lng: null,
        confidence: jitter(0.85, 0.1),
        gps_strong: false,
        indoor_confidence: jitter(0.85, 0.1),
      };
    });

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await admin.from('position_estimates').insert(chunk);
      if (error) {
        console.warn(`seed: position history for ${p.full_name} failed: ${error.message}`);
        break;
      }
    }
    console.log(`seed: ${samples} position estimates for ${p.full_name} (24 h × 1/30s)`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 10. sample alerts (3 acked + 2 unacked per patient)
// ──────────────────────────────────────────────────────────────────────────

async function ensureSampleAlerts(patients: PatientRow[], adminId: string): Promise<void> {
  for (const p of patients) {
    const { count } = await admin
      .from('alerts')
      .select('*', { count: 'exact', head: true })
      .eq('patient_id', p.id);
    if ((count ?? 0) >= 5) continue;

    const { data: rules } = await admin
      .from('alert_rules')
      .select('id, type, severity')
      .eq('patient_id', p.id);
    if (!rules || rules.length === 0) continue;
    const ruleByType = new Map(
      (rules as Array<{ id: string; type: string; severity: string }>).map((r) => [r.type, r]),
    );

    const baseTime = Date.now();
    const alerts: Array<{
      patient_id: string;
      rule_id: string;
      severity: string;
      fired_at: string;
      acknowledged_at: string | null;
      ack_by_caregiver_id: string | null;
      context: Record<string, unknown>;
    }> = [];

    function add(
      ruleType: string,
      hoursAgo: number,
      acked: boolean,
      context: Record<string, unknown>,
      severity?: string,
    ): void {
      const rule = ruleByType.get(ruleType);
      if (!rule) return;
      const firedAt = new Date(baseTime - hoursAgo * 3600 * 1000);
      alerts.push({
        patient_id: p.id,
        rule_id: rule.id,
        severity: severity ?? rule.severity,
        fired_at: firedAt.toISOString(),
        acknowledged_at: acked ? new Date(firedAt.getTime() + 5 * 60 * 1000).toISOString() : null,
        ack_by_caregiver_id: acked ? adminId : null,
        context,
      });
    }

    // Three acked (older), two unacked (recent).
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
    add('zone', 8, true, {
      kind: 'zone',
      space: 'indoor',
      direction: 'exit',
      x_canvas: 90,
      y_canvas: 240,
    });
    add('vitals', 1.5, false, {
      kind: 'vitals',
      metric: 'spo2_pct',
      value: 91,
      min: 92,
      max: null,
      breached: 'low',
    });
    add('fall', 0.4, false, {
      kind: 'fall',
      payload: { magnitude: 6.7, axis: 'z' },
    });

    if (alerts.length === 0) continue;
    const { error } = await admin.from('alerts').insert(alerts);
    if (error) {
      console.warn(`seed: sample alerts for ${p.full_name} failed: ${error.message}`);
      continue;
    }
    console.log(`seed: ${alerts.length} sample alerts for ${p.full_name}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const adminId = await ensureAdmin();
  await normaliseAdminProfile(adminId);

  const userClient = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await userClient.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (signIn.error) fail(`admin sign-in failed: ${signIn.error.message}`);

  await ensureAdminProvider(adminId, userClient);
  const patients = await ensurePatients(adminId, userClient);
  const devicesByPatient = await ensureDevicesForPatients(patients, userClient);
  const plans = await ensureFloorPlans(patients);
  await ensureBeacons(patients, plans);
  await ensureCalibrationPoints(patients, plans);
  await ensureAlertRules(patients);
  await ensureSensorHistory(patients, devicesByPatient);
  await ensurePositionHistory(patients);
  await ensureSampleAlerts(patients, adminId);

  console.log(`\nSeeded! Sign in at http://localhost:5173/login`);
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
}

main().catch((e) => {
  console.error('seed: unexpected error:', e);
  process.exit(1);
});
