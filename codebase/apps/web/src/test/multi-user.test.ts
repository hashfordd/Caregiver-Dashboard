import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Multi-user e2e against the hosted Supabase project.
//
// Drives the four project-peer demo accounts seeded by supabase/seed.sql.
// Verifies the load-bearing multi-user properties: RLS access scoping,
// role-gated writes, idempotent acknowledge_alert under concurrent
// callers, and audit-log + activity-feed attribution across actors.
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
// Requires the demo accounts to be present (run seed.sql via Studio first).
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

interface Peer {
  name: string;
  email: string;
  expectedRole: 'admin' | 'member';
  /** Patient ids this peer should see. Admins see all four. */
  visiblePatients: string[];
  client: SupabaseClient;
  userId?: string;
}

const PEERS: Omit<Peer, 'client'>[] = [
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
    expectedRole: 'member',
    visiblePatients: [EVE, HENRY],
  },
  {
    name: 'Hongting',
    email: '105961089@student.swin.edu.au',
    expectedRole: 'member',
    visiblePatients: [FRANK, GRACE],
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
  const peers = new Map<string, Peer>();

  beforeAll(async () => {
    if (!SB_URL || !SB_ANON_KEY) {
      throw new Error('SB_URL and SB_ANON_KEY must be set when RUN_MULTI_USER_TESTS=1');
    }

    // Sign each demo peer in. If any sign-in fails we surface a clear
    // message — the suite needs the seed to have been applied first.
    for (const cfg of PEERS) {
      const client = makeClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: cfg.email,
        password: DEMO_PASSWORD,
      });
      if (error || !data.user) {
        throw new Error(
          `Could not sign in ${cfg.name} (${cfg.email}). Run supabase/seed.sql in the Studio first. Underlying: ${error?.message ?? 'no user'}`,
        );
      }
      peers.set(cfg.name, { ...cfg, client, userId: data.user.id });
    }
  }, 60_000);

  afterAll(async () => {
    // Best-effort cleanup of test-marker rows. Each peer cleans up its
    // own writes (RLS enforces author-scope on the writeable tables we
    // touch — incidents.logged_by = auth.uid()).
    for (const peer of peers.values()) {
      await peer.client.from('incidents').delete().like('description', `%${RUN_MARKER}%`);
      await peer.client.auth.signOut();
    }
  }, 30_000);

  // ──────────────────────────────────────────────────────────────────────
  // Section 1 — access scoping via get_situation_overview
  // ──────────────────────────────────────────────────────────────────────

  for (const cfg of PEERS) {
    it(`${cfg.name} (${cfg.expectedRole}) sees exactly ${cfg.visiblePatients.length} patient(s) on the dashboard RPC`, async () => {
      const peer = peers.get(cfg.name)!;
      const { data, error } = await peer.client.rpc('get_situation_overview');
      expect(error).toBeNull();
      const rows = (data ?? []) as Array<{ patient_id: string }>;
      const ids = rows.map((r) => r.patient_id).sort();
      expect(ids).toEqual([...cfg.visiblePatients].sort());
    });
  }

  it('Noor (member) cannot read Frank patient row directly via PostgREST', async () => {
    const noor = peers.get('Noor')!;
    const { data, error } = await noor.client
      .from('patients')
      .select('id, full_name')
      .eq('id', FRANK);
    expect(error).toBeNull();
    expect(data).toEqual([]); // RLS filters silently — no row, no error.
  });

  it('Hongting (member) cannot read Henry patient row directly', async () => {
    const h = peers.get('Hongting')!;
    const { data, error } = await h.client.from('patients').select('id, full_name').eq('id', HENRY);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('Member UPDATE on a non-allocated patient affects 0 rows', async () => {
    const noor = peers.get('Noor')!;
    // Read Frank's current name via admin to anchor the comparison.
    const olivia = peers.get('Olivia')!;
    const before = await olivia.client
      .from('patients')
      .select('full_name')
      .eq('id', FRANK)
      .single();
    expect(before.error).toBeNull();
    const original = before.data?.full_name;

    // Noor tries to repaint Frank's name.
    await noor.client
      .from('patients')
      .update({ full_name: `Hijacked-${RUN_MARKER}` })
      .eq('id', FRANK);

    // Confirm via Olivia that nothing changed.
    const after = await olivia.client.from('patients').select('full_name').eq('id', FRANK).single();
    expect(after.data?.full_name).toBe(original);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 2 — role-gated writes on medications (admin-only INSERT/UPDATE)
  // ──────────────────────────────────────────────────────────────────────

  it('Member cannot INSERT a medication (admin-only RLS)', async () => {
    const noor = peers.get('Noor')!;
    const { error } = await noor.client.from('medications').insert({
      patient_id: EVE,
      name: `multi-user-test-med-${RUN_MARKER}`,
      dose: '5mg',
      prn: false,
      active: true,
    });
    // RLS INSERT denial — supabase-js returns an error with code 42501
    // (insufficient_privilege) or PostgREST's translated "new row
    // violates row-level security policy" message.
    expect(error).not.toBeNull();
    expect((error?.message ?? '').toLowerCase()).toMatch(/row-level security|policy|denied|42501/);
  });

  it('Admin CAN INSERT a medication on the same patient', async () => {
    const olivia = peers.get('Olivia')!;
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

    // Cleanup — admin can also delete.
    if (data?.id) {
      await olivia.client.from('medications').delete().eq('id', data.id);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 3 — incidents author scope + activity-feed propagation
  // ──────────────────────────────────────────────────────────────────────

  it('Noor logs an incident on her allocated patient (Eve)', async () => {
    const noor = peers.get('Noor')!;
    const { error } = await noor.client.from('incidents').insert({
      patient_id: EVE,
      logged_by: noor.userId!,
      occurred_at: new Date().toISOString(),
      type: 'other',
      severity: 1,
      description: `${RUN_MARKER}: Noor multi-user write — should appear in Olivia's activity feed.`,
      follow_up_required: false,
    });
    expect(error).toBeNull();
  });

  it('Olivia (admin) sees Noor’s incident in get_recent_activity', async () => {
    const olivia = peers.get('Olivia')!;
    const { data, error } = await olivia.client.rpc('get_recent_activity');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ summary: string; kind: string }>;
    const found = rows.find((r) => r.kind === 'incident' && r.summary.includes(RUN_MARKER));
    expect(found).toBeDefined();
  });

  it('Hongting cannot see Noor’s incident on Eve (cross-allocation hidden)', async () => {
    const h = peers.get('Hongting')!;
    const { data, error } = await h.client.rpc('get_recent_activity');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ summary: string }>;
    const found = rows.find((r) => r.summary.includes(RUN_MARKER));
    expect(found).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 4 — concurrent acknowledge_alert is idempotent
  // ──────────────────────────────────────────────────────────────────────

  it('Two admins ack the same alert concurrently — both succeed, single ack persisted', async () => {
    const olivia = peers.get('Olivia')!;
    const mohamed = peers.get('Mohamed')!;

    // Find an unacked alert visible to both admins. We accept any open
    // alert in the tenant — the seed leaves a few unacked rows.
    const { data: unacked } = await olivia.client
      .from('alerts')
      .select('id, patient_id, severity, fired_at, acknowledged_at')
      .is('acknowledged_at', null)
      .limit(1);
    const target = (unacked ?? [])[0] as { id: string } | undefined;
    if (!target) {
      // No open alerts — log and skip rather than fail. Re-run after a
      // fresh seed or after manually creating an alert.
      console.warn('No open alerts found — skipping concurrent-ack assertion.');
      return;
    }

    // Fire both acks in parallel.
    const [a, b] = await Promise.all([
      olivia.client.rpc('acknowledge_alert', { p_alert_id: target.id }),
      mohamed.client.rpc('acknowledge_alert', { p_alert_id: target.id }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    // Confirm the row has exactly one ack — both responses return the
    // same acknowledged_at + ack_by_caregiver_id (the first writer
    // committed, the second is the idempotent path).
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

  it('Admin can read get_provider_audit_log; member gets empty', async () => {
    const olivia = peers.get('Olivia')!;
    const noor = peers.get('Noor')!;

    const adm = await olivia.client.rpc('get_provider_audit_log', { p_limit: 5 });
    const mem = await noor.client.rpc('get_provider_audit_log', { p_limit: 5 });

    expect(adm.error).toBeNull();
    expect(mem.error).toBeNull();
    expect(Array.isArray(adm.data)).toBe(true);
    // Admin should see at least one entry (the seed itself generates
    // audit rows via the audit_log_record trigger on every write).
    expect((adm.data as unknown[]).length).toBeGreaterThan(0);
    // Member is filtered to zero by the RPC's provider_role guard.
    expect((mem.data as unknown[]).length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Section 6 — provider overview surfaces tenant-level rollups
  // ──────────────────────────────────────────────────────────────────────

  it('get_provider_overview reports a non-trivial caregiver_count', async () => {
    const olivia = peers.get('Olivia')!;
    const { data, error } = await olivia.client.rpc('get_provider_overview');
    expect(error).toBeNull();
    const row = (data as Array<{ caregiver_count: number; patient_count: number }> | null)?.[0];
    expect(row).toBeDefined();
    // 1 (you) + 3 (Anna/Priya/Marcus) + 4 (Olivia/Mohamed/Noor/Hongting) = 8
    // Conservative lower bound — exact count varies if you've added more.
    expect(row!.caregiver_count).toBeGreaterThanOrEqual(4);
    expect(row!.patient_count).toBeGreaterThanOrEqual(4);
  });
});
