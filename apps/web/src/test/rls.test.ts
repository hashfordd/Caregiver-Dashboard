import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// This file talks to a locally running Supabase stack. It's gated behind
// RUN_RLS_TESTS=1 so CI runs it on demand against a seeded instance and the
// dev loop doesn't pay for it. To run locally:
//
//   supabase start
//   RUN_RLS_TESTS=1 \
//   SB_URL=http://127.0.0.1:54321 \
//   SB_ANON_KEY=<publishable key from `supabase status`> \
//   SB_SERVICE_KEY=<secret key from `supabase status`> \
//   npm run test --workspace @alzcare/web -- src/test/rls.test.ts
//
// SB_SERVICE_KEY is the privileged admin key — never piped to a browser.

const enabled = process.env.RUN_RLS_TESTS === '1';
const SB_URL = process.env.SB_URL ?? 'http://127.0.0.1:54321';
const SB_ANON_KEY = process.env.SB_ANON_KEY ?? '';
const SB_SERVICE_KEY = process.env.SB_SERVICE_KEY ?? '';

type TestUser = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

async function createUser(
  admin: SupabaseClient,
  emailPrefix: string,
  fullName: string,
): Promise<TestUser> {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@rlstest.local`;
  const password = 'TestPass123!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: 'family' },
  });
  if (error || !data.user) throw error ?? new Error('user creation failed');
  // Per-client in-memory session: jsdom's shared localStorage would otherwise
  // let later sign-ins clobber earlier ones, breaking multi-user tests.
  const client = createClient(SB_URL, SB_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, password, client };
}

describe.skipIf(!enabled)('RLS denial — F1 caregiver write surface', () => {
  let admin: SupabaseClient;
  let alice: TestUser;
  let bob: TestUser;
  let alicePatientId: string;

  beforeAll(async () => {
    if (!SB_ANON_KEY || !SB_SERVICE_KEY) {
      throw new Error('SB_ANON_KEY and SB_SERVICE_KEY must be set when RUN_RLS_TESTS=1');
    }
    admin = createClient(SB_URL, SB_SERVICE_KEY);
    alice = await createUser(admin, 'alice', 'Alice RLS');
    bob = await createUser(admin, 'bob', 'Bob RLS');

    // Alice creates a patient (auto-allocated via the RPC).
    const { data, error } = await alice.client.rpc('create_patient_with_allocation', {
      p_full_name: 'Alice Patient',
      p_dob: null,
      p_description: null,
    });
    if (error || !data) throw error ?? new Error('rpc returned no data');
    alicePatientId = (data as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    if (!enabled || !admin) return;
    if (alice?.id) await admin.auth.admin.deleteUser(alice.id);
    if (bob?.id) await admin.auth.admin.deleteUser(bob.id);
  }, 30_000);

  it('Alice can read her own patient', async () => {
    const { data, error } = await alice.client
      .from('patients')
      .select('id, full_name')
      .eq('id', alicePatientId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Bob cannot read Alice's patient", async () => {
    const { data, error } = await bob.client
      .from('patients')
      .select('id, full_name')
      .eq('id', alicePatientId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('Alice can self-update her caregivers row', async () => {
    const newName = `Alice Updated ${Date.now()}`;
    const { error } = await alice.client
      .from('caregivers')
      .update({ full_name: newName })
      .eq('id', alice.id);
    expect(error).toBeNull();

    const { data } = await alice.client
      .from('caregivers')
      .select('full_name')
      .eq('id', alice.id)
      .single();
    expect(data?.full_name).toBe(newName);
  });

  it("F10: Bob cannot pair an unpaired device to Alice's patient via update", async () => {
    // Service role inserts an unpaired device.
    const mac = `aa:bb:cc:f1:0a:${Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')}`;
    const { data: device } = await admin
      .from('devices')
      .insert({ mac_address: mac, paired_patient_id: null })
      .select('id')
      .single();
    const deviceId = (device as { id: string }).id;

    // Bob tries to repaint it onto Alice's patient. RLS `with check`
    // should reject (the post-update row doesn't pass is_caregiver_for
    // for Bob).
    await bob.client
      .from('devices')
      .update({ paired_patient_id: alicePatientId })
      .eq('id', deviceId);

    const { data: after } = await admin
      .from('devices')
      .select('paired_patient_id')
      .eq('id', deviceId)
      .single();
    expect(after?.paired_patient_id).toBeNull();

    await admin.from('devices').delete().eq('id', deviceId);
  });

  it("F10: Bob cannot rewrite a device paired to Alice's patient", async () => {
    const { data: device } = await admin
      .from('devices')
      .insert({
        mac_address: `aa:bb:cc:f1:0b:${Math.floor(Math.random() * 256)
          .toString(16)
          .padStart(2, '0')}`,
        paired_patient_id: alicePatientId,
      })
      .select('id')
      .single();
    const deviceId = (device as { id: string }).id;

    // Bob tries to change the firmware_version. RLS `using` should
    // reject (pre-update row is paired to Alice, not Bob).
    await bob.client.from('devices').update({ firmware_version: 'hijacked' }).eq('id', deviceId);

    const { data: after } = await admin
      .from('devices')
      .select('firmware_version')
      .eq('id', deviceId)
      .single();
    expect(after?.firmware_version).toBeNull();

    await admin.from('devices').delete().eq('id', deviceId);
  });

  it('F10: pair_device RPC raises when caller is not allocated to the patient', async () => {
    const { error } = await bob.client.rpc('pair_device', {
      p_mac_address: `aa:bb:cc:f1:0c:${Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, '0')}`,
      p_patient_id: alicePatientId,
      p_label: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/not allocated|allocated/i);
  });

  it("Bob cannot read Alice's sensor_readings (F4 scope)", async () => {
    // Insert a reading via the service-role admin client (bridge would do
    // this in production via mqtt_bridge), then assert Bob's session sees
    // none.
    await admin.from('devices').insert({
      id: '99999999-9999-9999-9999-999999999991',
      mac_address: 'mock-rls-bob-test',
      paired_patient_id: alicePatientId,
      last_seen_at: new Date().toISOString(),
    });
    await admin.from('sensor_readings').insert({
      patient_id: alicePatientId,
      device_id: '99999999-9999-9999-9999-999999999991',
      recorded_at: new Date().toISOString(),
      hr_bpm: 72,
      spo2_pct: 98,
      temp_c: 36.5,
    });

    const { data, error } = await bob.client
      .from('sensor_readings')
      .select('id')
      .eq('patient_id', alicePatientId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("Bob's roster does not include Alice's patient (F2 scope)", async () => {
    const { data, error } = await bob.client.from('patients').select('id, full_name');
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(alicePatientId);
  });

  it("F5: Bob cannot insert a floor plan against Alice's patient", async () => {
    const { error } = await bob.client.from('floor_plans').insert({
      patient_id: alicePatientId,
      name: 'Hijacked plan',
      canvas_json: { objects: [] },
      scale_meters_per_pixel: null,
    });
    expect(error).not.toBeNull();

    const { data: rows } = await admin
      .from('floor_plans')
      .select('id')
      .eq('patient_id', alicePatientId);
    expect(rows ?? []).toHaveLength(0);
  });

  it("F5: Bob cannot update an existing floor plan owned by Alice's patient", async () => {
    const { data: inserted } = await admin
      .from('floor_plans')
      .insert({
        patient_id: alicePatientId,
        name: 'Original',
        canvas_json: { objects: [] },
        scale_meters_per_pixel: 0.05,
      })
      .select('id')
      .single();
    const planId = (inserted as { id: string }).id;

    await bob.client.from('floor_plans').update({ name: 'Hijacked' }).eq('id', planId);

    const { data: after } = await admin
      .from('floor_plans')
      .select('name')
      .eq('id', planId)
      .single();
    expect(after?.name).toBe('Original');

    await admin.from('floor_plans').delete().eq('id', planId);
  });

  it("Bob cannot update Alice's caregivers row (zero rows affected)", async () => {
    const { data: beforeRow } = await admin
      .from('caregivers')
      .select('full_name')
      .eq('id', alice.id)
      .single();
    const before = beforeRow?.full_name;

    await bob.client.from('caregivers').update({ full_name: 'Hijacked' }).eq('id', alice.id);

    const { data: afterRow } = await admin
      .from('caregivers')
      .select('full_name')
      .eq('id', alice.id)
      .single();
    expect(afterRow?.full_name).toBe(before);
  });
});
