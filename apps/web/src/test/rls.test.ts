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
      p_notes: null,
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
