// Idempotent demo seed for the local Supabase stack.
//
// Ensures:
//   - admin@bizzieapp.com / DemoPass123! exists with role=professional
//   - three demo patients allocated to that user (creator-auto-allocate via
//     create_patient_with_allocation)
//   - one paired device per patient (pair_device RPC + label)
//   - sixty seconds of 1 Hz vitals history per device, written via service
//     role
//
// Re-running is safe — the script skips seeding when admin already has
// three or more allocated patients.
//
// Usage:
//   SB_SERVICE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2) \
//     npm run seed

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SB_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SB_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = process.env.SB_SERVICE_KEY ?? '';
const ADMIN_EMAIL = 'admin@bizzieapp.com';
const ADMIN_PASSWORD = 'DemoPass123!';

if (!SERVICE_KEY) {
  console.error(
    'seed: SB_SERVICE_KEY env var required (the service-role key from `supabase status`).',
  );
  process.exit(2);
}

const admin: SupabaseClient = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PATIENTS = [
  {
    full_name: 'Margaret Holloway',
    dob: '1947-03-12',
    notes: 'Mid-stage Alzheimer’s. Lives at home with her daughter; carer visits twice weekly.',
  },
  {
    full_name: "James O'Connor",
    dob: '1942-08-30',
    notes: 'Recent diagnosis. Active; walks twice daily. Watch for fall risk on stairs.',
  },
  {
    full_name: 'Eleanor Tanaka',
    dob: '1951-11-04',
    notes: 'Late-stage care. Mostly bedridden; monitor SpO₂ closely overnight.',
  },
];

function fail(msg: string): never {
  console.error(`seed: ${msg}`);
  process.exit(1);
}

function randomMac(): string {
  const hex = () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
}

async function ensureAdmin(): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Admin Demo', role: 'professional' },
  });

  if (created.data.user) {
    console.log(`seed: created admin user ${ADMIN_EMAIL} (${created.data.user.id})`);
    return created.data.user.id;
  }

  // listUsers is paginated; for a tiny dev DB the first page covers it.
  const list = await admin.auth.admin.listUsers();
  const existing = list.data.users.find((u) => u.email === ADMIN_EMAIL);
  if (existing) {
    console.log(`seed: admin user ${ADMIN_EMAIL} already present (${existing.id})`);
    return existing.id;
  }
  fail(`could not find or create admin user: ${created.error?.message ?? 'unknown'}`);
}

async function alreadySeeded(adminId: string): Promise<boolean> {
  const { count, error } = await admin
    .from('caregiver_patient')
    .select('*', { count: 'exact', head: true })
    .eq('caregiver_id', adminId);
  if (error) fail(`allocation count check failed: ${error.message}`);
  return (count ?? 0) >= PATIENTS.length;
}

async function main(): Promise<void> {
  const adminId = await ensureAdmin();

  if (await alreadySeeded(adminId)) {
    console.log(
      `seed: ${ADMIN_EMAIL} already has ${PATIENTS.length}+ allocated patients; skipping.`,
    );
    console.log(`\nSign in at http://localhost:5173/login`);
    console.log(`  email:    ${ADMIN_EMAIL}`);
    console.log(`  password: ${ADMIN_PASSWORD}`);
    return;
  }

  // Sign in as the admin so create_patient_with_allocation runs under their JWT.
  const userClient = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await userClient.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (signIn.error) fail(`admin sign-in failed: ${signIn.error.message}`);

  for (const p of PATIENTS) {
    const { data: patientRaw, error: patientErr } = await userClient.rpc(
      'create_patient_with_allocation',
      {
        p_full_name: p.full_name,
        p_dob: p.dob,
        p_notes: p.notes,
      },
    );
    if (patientErr || !patientRaw) {
      console.error(
        `seed: create_patient ${p.full_name} failed: ${patientErr?.message ?? 'no data'}`,
      );
      continue;
    }
    const patient = patientRaw as { id: string };

    const mac = randomMac();
    const { data: deviceRaw, error: pairErr } = await userClient.rpc('pair_device', {
      p_mac_address: mac,
      p_patient_id: patient.id,
      p_label: 'wrist',
    });
    if (pairErr || !deviceRaw) {
      console.error(
        `seed: pair_device for ${p.full_name} failed: ${pairErr?.message ?? 'no data'}`,
      );
      continue;
    }
    const device = deviceRaw as { id: string };

    const baseTime = Date.now();
    const rows = Array.from({ length: 60 }, (_, i) => ({
      patient_id: patient.id,
      device_id: device.id,
      recorded_at: new Date(baseTime - i * 1000).toISOString(),
      hr_bpm: 65 + Math.round(Math.random() * 20),
      spo2_pct: Math.round((96 + Math.random() * 3) * 10) / 10,
      temp_c: Math.round((36.4 + Math.random() * 0.4) * 10) / 10,
    }));
    const { error: histErr } = await admin.from('sensor_readings').insert(rows);
    if (histErr) {
      console.error(`seed: history for ${p.full_name} failed: ${histErr.message}`);
      continue;
    }

    console.log(`seed: ${p.full_name} (${patient.id}) + device ${mac} + 60s of vitals`);
  }

  console.log(`\nSeeded! Sign in at http://localhost:5173/login`);
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
}

main().catch((e) => {
  console.error('seed: unexpected error:', e);
  process.exit(1);
});
