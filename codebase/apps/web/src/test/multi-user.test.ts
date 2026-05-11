import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Multi-user e2e against the hosted Supabase project.
//
// Drives the four project-peer demo accounts (all admins) plus Anna
// (seeded as a member by supabase/seed.sql) so the suite still proves
// the member-tier denial paths.
//
// Gated behind RUN_MULTI_USER_TESTS=1 so the default `npm run test`
// loop stays hermetic. To run locally against the hosted project:
//
//   set -a; source codebase/apps/web/.env.local; set +a
//   RUN_MULTI_USER_TESTS=1 \
//   SB_URL="$VITE_SUPABASE_URL" \
//   SB_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
//   npm run test --workspace @alzcare/web -- src/test/multi-user.test.ts
//
// Requires the demo accounts to be present (run seed.sql via Studio +
// the latest peer-promotion migration via `supabase db push --linked`).
// ─────────────────────────────────────────────────────────────────────────────

const enabled = process.env.RUN_MULTI_USER_TESTS === '1';
const SB_URL = process.env.SB_URL ?? '';
const SB_ANON_KEY = process.env.SB_ANON_KEY ?? '';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo1234!';

// Seeded patient ids (must match supabase/seed.sql).
const EVE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const FRANK = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
const GRACE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
const HENRY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';

interface SignedInUser {
  name: string;
  email: string;
  expectedRole: 'admin' | 'member';
  /** Patient ids this peer should see. */
  visiblePatients: string[];
  client: SupabaseClient;
  userId?: string;
}

// All four project peers are admins of Acme Care Co with full
// allocation. Anna is a seeded member, allocated to Eve + Grace — kept
// in the suite to exercise the member-denial paths.
const ACCOUNTS: Omit<SignedInUser, 'client' | 'userId'>[] = [
  {
    name: 'Olivia',
    email: '103642997@student.swin.edu.au',
    expectedRole: 'admin',
    visiblePatients: [EVE, FRANK, GRACE, HENRY],
  },
  {
    name: 'Mohamed',
    email: '104341981@student.swin.edu.au',
    expectedRole: 'admin',
    visiblePatients: [EVE, FRANK, GRACE, HENRY],
  },
  {
    name: 'Noor',
    email: '104171926@student.swin.edu.au',
    expectedRole: 'admin',
    visiblePatients: [EVE, FRANK, GRACE, HENRY],
  },
  {
    name: 'Hongting',
    email: '105961089@student.swin.edu.au',
    expectedRole: 'admin',
    visiblePatients: [EVE, FRANK, GRACE, HENRY],
  },
  {
    name: 'Anna',
    email: 'anna+demo@bizzieapp.com',
    expectedRole: 'member',
    visiblePatients: [EVE, GRACE],
  },
];

function makeClient(): SupabaseClient {
  return createClient(SB_URL, SB_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Each test that writes uses this marker so cleanup can find its rows
// without touching the seed.
const RUN_MARKER = `multi-user-test-${Date.now()}`;

describe.skipIf(!enabled)('Multi-user · same-tenant access scoping + role gating', () => {
  const users = new Map<string, SignedInUser>();

  beforeAll(async () => {
    if (!SB_URL || !SB_ANON_KEY) {
      throw new Error('SB_URL and SB_ANON_KEY must be set when RUN_MULTI_USER_TESTS=1');
    }

    for (const cfg of ACCOUNTS) {
      const client = makeClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: cfg.email,
        password: DEMO_PASSWORD,
      });
      if (error || !data.user) {
        throw new Error(
          `Could not sign in ${cfg.name} (${cfg.email}). Run supabase/seed.sql in the Studio + supabase db push --linked first. Underlying: ${error?.message ?? 'no user'}`,
        );
      }
      users.set(cfg.name, { ...cfg, client, userId: data.user.id });
    }
  }, 60_000);

  afterAll(async () => {
    for (const u of users.values()) {
      await u.client.from('incidents').delete().like('description', `%${RUN_MARKER}%`);
      await u.client.auth.signOut();
    }
  }, 30_000);

  // ──────────────────────────────────────────────────────────────────────
  // Section 1 — access scoping via get_situation_overview
  // ──────────────────────────────────────────────────────────────────────

  for (const cfg of ACCOUNTS) {
    it(`${cfg.name} (${cfg.expectedRole}) sees exactly ${cfg.visiblePatients.length} patient(s) on the dashboard RPC`, async () => {
      const u = users.get(cfg.name)!;
      const { data, error } = await u.client.rpc('get_situation_overview');
      expect(error).toBeNull();
      const rows = (data ?? []) as Array<{ patient_id: string }>;
      const ids = rows.map((r) => r.patient_id).sort();
      expect(ids).toEqual([...cfg.visiblePatients].sort());
    });
  }

  it('Anna (member) cannot read Frank patient row directly via PostgREST', async () => {
    const anna = users.get('Anna')!;
    const { data, error } = await anna.client
      .from('patients')
      .select('id, full_name')
      .eq('id', FRANK);
    expect(error).toBeNull();
    expect(data).toEqual([]); // RLS filters silently — no row, no error.
  });

  it('Anna (member) cannot read Henry patient row directly', async () => {
    const anna = users.get('Anna')!;
    const { data, error } = await anna.client
      .from('patients')
      .select('id, full_name')
      .eq('id', HENRY);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('Member UPDATE on a non-allocated patient affects 0 rows', async () => {
    const anna = users.get('Anna')!;
    const olivia = users.get('Olivia')!;
    const before = await olivia.client
      .from('patients')
      .select('full_name')
      .eq('id', FRANK)
      .single();
    expect(before.error).toBeNull();
    const original = before.data?.full_name;

    await anna.client
      .from('patients')
      .update({ full_name: `Hijacked-${RUN_MARKER}` })
      .eq('id', FRANK);

    const after = await olivia.client.from('patients').select('full_name').eq('id', FRANK).single();
    expect(after.data?.full_name).toBe(original);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 2 — role-gated writes on medications (admin-only INSERT/UPDATE)
  // ──────────────────────────────────────────────────────────────────────

  it('Anna (member) cannot INSERT a medication (admin-only RLS)', async () => {
    const anna = users.get('Anna')!;
    const { error } = await anna.client.from('medications').insert({
      patient_id: EVE,
      name: `multi-user-test-med-${RUN_MARKER}`,
      dose: '5mg',
      prn: false,
      active: true,
    });
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/row-level security|policy|denied|42501/);
  });

  it('Olivia (admin) CAN INSERT a medication on the same patient', async () => {
    const olivia = users.get('Olivia')!;
    const testName = `multi-user-test-med-${RUN_MARKER}`;
    const { data, error } = await olivia.client
      .from('medications')
      .insert({
        patient_id: EVE,
        name: testName,
        dose: '1 mg',
        prn: true,
        active: true,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();

    if (data?.id) {
      await olivia.client.from('medications').delete().eq('id', data.id);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 3 — incidents author scope + activity-feed propagation
  // ──────────────────────────────────────────────────────────────────────

  it('Noor (peer admin) logs an incident on Eve', async () => {
    const noor = users.get('Noor')!;
    const { error } = await noor.client.from('incidents').insert({
      patient_id: EVE,
      logged_by: noor.userId!,
      occurred_at: new Date().toISOString(),
      type: 'other',
      severity: 1,
      description: `${RUN_MARKER}: Noor multi-user write — should appear in every peer's activity feed.`,
      follow_up_required: false,
    });
    expect(error).toBeNull();
  });

  it('Mohamed sees Noor’s incident in get_recent_activity', async () => {
    const mohamed = users.get('Mohamed')!;
    const { data, error } = await mohamed.client.rpc('get_recent_activity');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ summary: string; kind: string }>;
    const found = rows.find((r) => r.kind === 'incident' && r.summary.includes(RUN_MARKER));
    expect(found).toBeDefined();
  });

  it('Anna (member, not allocated to Frank/Henry but allocated to Eve) DOES see Noor’s incident on Eve', async () => {
    // Anna is allocated to Eve, so she sees the incident. This confirms
    // the activity feed honours allocation rather than role — a peer
    // admin's write on a member's allocated patient is visible to that
    // member.
    const anna = users.get('Anna')!;
    const { data, error } = await anna.client.rpc('get_recent_activity');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ summary: string }>;
    const found = rows.find((r) => r.summary.includes(RUN_MARKER));
    expect(found).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 4 — concurrent acknowledge_alert is idempotent
  // ──────────────────────────────────────────────────────────────────────

  it('Two admins ack the same alert concurrently — both succeed, single ack persisted', async () => {
    const olivia = users.get('Olivia')!;
    const mohamed = users.get('Mohamed')!;

    const { data: unacked } = await olivia.client
      .from('alerts')
      .select('id, patient_id, severity, fired_at, acknowledged_at')
      .is('acknowledged_at', null)
      .limit(1);
    const target = (unacked ?? [])[0] as { id: string } | undefined;
    if (!target) {
      console.warn('No open alerts found — skipping concurrent-ack assertion.');
      return;
    }

    const [a, b] = await Promise.all([
      olivia.client.rpc('acknowledge_alert', { p_alert_id: target.id }),
      mohamed.client.rpc('acknowledge_alert', { p_alert_id: target.id }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const aRow =
      (a.data as { acknowledged_at: string | null; ack_by_caregiver_id: string | null } | null) ??
      null;
    const bRow =
      (b.data as { acknowledged_at: string | null; ack_by_caregiver_id: string | null } | null) ??
      null;
    expect(aRow?.acknowledged_at).toBe(bRow?.acknowledged_at);
    expect(aRow?.ack_by_caregiver_id).toBe(bRow?.ack_by_caregiver_id);
    expect(aRow?.acknowledged_at).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 5 — provider audit log honours admin-only gate
  // ──────────────────────────────────────────────────────────────────────

  it('Peer admins all see audit log; Anna (member) gets empty', async () => {
    const olivia = users.get('Olivia')!;
    const hongting = users.get('Hongting')!;
    const anna = users.get('Anna')!;

    const adm = await olivia.client.rpc('get_provider_audit_log', { p_limit: 5 });
    const peerAdm = await hongting.client.rpc('get_provider_audit_log', { p_limit: 5 });
    const mem = await anna.client.rpc('get_provider_audit_log', { p_limit: 5 });

    expect(adm.error).toBeNull();
    expect(peerAdm.error).toBeNull();
    expect(mem.error).toBeNull();
    expect((adm.data as unknown[]).length).toBeGreaterThan(0);
    expect((peerAdm.data as unknown[]).length).toBeGreaterThan(0);
    expect((mem.data as unknown[]).length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 6 — provider overview surfaces tenant-level rollups
  // ──────────────────────────────────────────────────────────────────────

  it('get_provider_overview reports an admin_count that includes every peer', async () => {
    const olivia = users.get('Olivia')!;
    const { data, error } = await olivia.client.rpc('get_provider_overview');
    expect(error).toBeNull();
    const row = (
      data as Array<{
        caregiver_count: number;
        patient_count: number;
        admin_count: number;
      }> | null
    )?.[0];
    expect(row).toBeDefined();
    // You + Marcus + 4 peers = at least 6 admins.
    expect(row!.admin_count).toBeGreaterThanOrEqual(6);
    expect(row!.patient_count).toBeGreaterThanOrEqual(4);
  });
});
