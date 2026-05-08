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

// Phase B: a fresh caregiver has no provider until they create one or
// accept an invite. Tests that exercise per-patient RLS need each user
// to own a provider so create_patient_with_allocation can succeed and
// the provider tenancy boundary is exercised.
async function bootstrapProvider(user: TestUser, providerName: string): Promise<string> {
  const { data, error } = await user.client.rpc('create_care_provider', {
    p_name: providerName,
  });
  if (error || !data) throw error ?? new Error('create_care_provider returned no data');
  return (data as { id: string }).id;
}

describe.skipIf(!enabled)('RLS denial — F1 caregiver write surface', () => {
  let admin: SupabaseClient;
  let alice: TestUser;
  let bob: TestUser;
  let aliceProviderId: string;
  let bobProviderId: string;
  let alicePatientId: string;

  beforeAll(async () => {
    if (!SB_ANON_KEY || !SB_SERVICE_KEY) {
      throw new Error('SB_ANON_KEY and SB_SERVICE_KEY must be set when RUN_RLS_TESTS=1');
    }
    admin = createClient(SB_URL, SB_SERVICE_KEY);
    alice = await createUser(admin, 'alice', 'Alice RLS');
    bob = await createUser(admin, 'bob', 'Bob RLS');

    // Each test user owns a separate provider — the cross-provider
    // tenancy boundary is the load-bearing predicate Phase B introduced.
    aliceProviderId = await bootstrapProvider(alice, 'Alice Care Co');
    bobProviderId = await bootstrapProvider(bob, 'Bob Care Co');

    // Alice creates a patient inside her provider (auto-allocated).
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
    // care_providers FK is on delete restrict, so unbind the caregiver
    // first then delete the provider rows. Use the service-role admin
    // client to bypass RLS for cleanup.
    if (alice?.id) {
      await admin.from('caregivers').update({ care_provider_id: null }).eq('id', alice.id);
      await admin.auth.admin.deleteUser(alice.id);
    }
    if (bob?.id) {
      await admin.from('caregivers').update({ care_provider_id: null }).eq('id', bob.id);
      await admin.auth.admin.deleteUser(bob.id);
    }
    if (aliceProviderId) await admin.from('care_providers').delete().eq('id', aliceProviderId);
    if (bobProviderId) await admin.from('care_providers').delete().eq('id', bobProviderId);
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

  // ────────────────────────────────────────────────────────────────────────
  // Phase B — care provider tenancy
  // ────────────────────────────────────────────────────────────────────────

  it('Phase-B: Alice is admin of her own provider after bootstrap', async () => {
    const { data } = await alice.client
      .from('caregivers')
      .select('care_provider_id, provider_role')
      .eq('id', alice.id)
      .single();
    expect((data as { care_provider_id: string }).care_provider_id).toBe(aliceProviderId);
    expect((data as { provider_role: string }).provider_role).toBe('admin');
  });

  it('Phase-B: cross-provider patient read is denied', async () => {
    // Bob is admin of his own provider, NOT a member of Alice's. The
    // patients_tenant_read predicate combines is_caregiver_for(id) with
    // is_provider_admin(care_provider_id) of *the row's* provider — Bob
    // satisfies neither for Alice's patient.
    const { data } = await bob.client
      .from('patients')
      .select('id, full_name')
      .eq('id', alicePatientId);
    expect(data).toEqual([]);
  });

  it('Phase-B: cannot create a patient before joining a provider', async () => {
    const solo = await createUser(admin, 'solo', 'Solo Test');
    // Solo has no provider — the RPC must refuse.
    const { error } = await solo.client.rpc('create_patient_with_allocation', {
      p_full_name: 'Should fail',
      p_dob: null,
      p_description: null,
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/no provider|create one|invite/);
    await admin.auth.admin.deleteUser(solo.id);
  });

  it('Phase-B: invite_caregiver from a non-admin raises', async () => {
    // Alice's provider has Alice as admin. Add a member by invite +
    // accept manually so the member can attempt an invite (which must fail).
    // Direct SQL setup via service-role admin to avoid email plumbing in tests.
    const memberUser = await createUser(admin, 'member', 'Member Test');
    // Service-role admin promotes them into Alice's provider directly:
    await admin
      .from('caregivers')
      .update({ care_provider_id: aliceProviderId, provider_role: 'member' })
      .eq('id', memberUser.id);

    const { error } = await memberUser.client.rpc('invite_caregiver', {
      p_email: 'spam@example.com',
      p_role: 'member',
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/admin only/);

    // Cleanup
    await admin.from('caregivers').update({ care_provider_id: null }).eq('id', memberUser.id);
    await admin.auth.admin.deleteUser(memberUser.id);
  });

  it('Phase-B: allocate_patient across providers is forbidden', async () => {
    // Alice (admin of provider A) tries to allocate Bob (in provider B)
    // to her patient. The RPC must refuse "target caregiver is not in
    // caller provider".
    const { error } = await alice.client.rpc('allocate_patient', {
      p_patient_id: alicePatientId,
      p_caregiver_id: bob.id,
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/not in caller provider/);
  });

  it('Phase-B: accept_invite with bogus token raises', async () => {
    const fresh = await createUser(admin, 'fresh', 'Fresh Test');
    const { error } = await fresh.client.rpc('accept_invite', {
      p_token: 'this-is-not-a-real-token',
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/not found/);
    await admin.auth.admin.deleteUser(fresh.id);
  });

  it('Phase-B: caregiver_patient cross-provider invariant blocks direct insert', async () => {
    // Even with service-role bypassing RLS, the BEFORE INSERT trigger
    // enforces the same-provider invariant. (Service role doesn't
    // bypass triggers.)
    const { error } = await admin
      .from('caregiver_patient')
      .insert({ caregiver_id: bob.id, patient_id: alicePatientId });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/cross-provider/);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Items 79+80+83 — caregivers self-update lockdown + set_caregiver_role.
  // ──────────────────────────────────────────────────────────────────────

  it('Phase-I.A: member cannot self-promote provider_role', async () => {
    // Bob is a member of his own tenant. The trigger should refuse a
    // direct UPDATE that touches provider_role.
    const { error } = await bob.client
      .from('caregivers')
      .update({ provider_role: 'admin' })
      .eq('id', bob.id);
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/set_caregiver_role/);
  });

  it('Phase-I.A: member cannot rebind care_provider_id on themselves', async () => {
    // Bob attempts to rebind to Alice's tenant.
    const { error } = await bob.client
      .from('caregivers')
      .update({ care_provider_id: aliceProviderId })
      .eq('id', bob.id);
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/set_caregiver_role/);
  });

  it('Phase-I.A: admin can promote a peer via set_caregiver_role', async () => {
    // Alice invites a member into her tenant via the admin path
    // (bootstrap a fresh user, set them admin via the RPC, then back to
    // member to leave the tenant in the same shape afterward).
    const peer = await createUser(admin, 'peer', 'Peer Test');
    // Move peer into Alice's tenant by admin-bypass (test helper).
    await admin
      .from('caregivers')
      .update({ care_provider_id: aliceProviderId, provider_role: 'member' })
      .eq('id', peer.id);

    const { error: promoteErr } = await alice.client.rpc('set_caregiver_role', {
      p_target_id: peer.id,
      p_role: 'admin',
    });
    expect(promoteErr).toBeNull();

    const { data: row } = await admin
      .from('caregivers')
      .select('provider_role')
      .eq('id', peer.id)
      .single();
    expect((row as { provider_role: string }).provider_role).toBe('admin');

    // Cleanup
    await admin
      .from('caregivers')
      .update({ care_provider_id: null, provider_role: 'member' })
      .eq('id', peer.id);
    await admin.auth.admin.deleteUser(peer.id);
  });

  it('Phase-I.A: set_caregiver_role refuses cross-tenant target', async () => {
    // Alice tries to promote Bob (different tenant). Must refuse.
    const { error } = await alice.client.rpc('set_caregiver_role', {
      p_target_id: bob.id,
      p_role: 'admin',
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/forbidden/);
  });

  it('Phase-I.A: last admin cannot self-demote', async () => {
    // Alice is the only admin in her tenant. Self-demote must refuse.
    const { error } = await alice.client.rpc('set_caregiver_role', {
      p_target_id: alice.id,
      p_role: 'member',
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/cannot_demote_last_admin/);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Item 86 — peer caregiver email + company_name closed; directory RPC.
  // ──────────────────────────────────────────────────────────────────────

  it('Phase-I.A: peer cannot read another caregivers full row directly', async () => {
    // Alice is in her own tenant. Bob is in another. The new
    // caregivers_self_read policy returns only auth.uid() rows.
    const { data } = await alice.client
      .from('caregivers')
      .select('id, email, full_name')
      .neq('id', alice.id);
    expect(data ?? []).toHaveLength(0);
  });

  it('Phase-I.A: get_caregiver_directory exposes id+full_name+role for tenant peers', async () => {
    const peer = await createUser(admin, 'dirpeer', 'Directory Peer');
    await admin
      .from('caregivers')
      .update({ care_provider_id: aliceProviderId, provider_role: 'member' })
      .eq('id', peer.id);

    const { data, error } = await alice.client.rpc('get_caregiver_directory');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ id: string; full_name: string; provider_role: string }>;
    const found = rows.find((r) => r.id === peer.id);
    expect(found).toBeDefined();
    expect(found?.full_name).toBe('Directory Peer');
    // Email + company_name + care_provider_id are NOT in the directory shape.
    expect(Object.keys(found ?? {})).not.toContain('email');
    expect(Object.keys(found ?? {})).not.toContain('company_name');

    // Cleanup
    await admin.from('caregivers').update({ care_provider_id: null }).eq('id', peer.id);
    await admin.auth.admin.deleteUser(peer.id);
  });
});
