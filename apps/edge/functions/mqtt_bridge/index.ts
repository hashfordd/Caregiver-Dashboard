// HTTP entry point for the mqtt_bridge. Used by CI tests and (optionally) by
// the mock telemetry generator running in `--mode bridge` against a locally
// served Supabase function. The validation + persistence logic is owned by
// the shared `processMessage` module so the eventual long-running MQTT
// subscriber (Phase 1 closure — see BACKLOG) calls the same code path.
//
// CROSS_CUTTING §1: this entry holds the service-role key in env and never
// exposes it to clients.
// CROSS_CUTTING §11: shared SSOT between HTTP and long-running runtimes.
//
// Item 81: service-role bearer auth on the HTTP entry. The mock-telemetry
// tool and any internal caller must include `Authorization: Bearer <KEY>`.
// Uses constant-time compare to prevent timing-oracle attacks, mirroring
// the pattern in position_estimator and rules_engine.

import { createClient } from '@supabase/supabase-js';
import { processMessage } from './processMessage.ts';

interface BridgePayload {
  topic: string;
  message: unknown;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'mqtt_bridge: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    }),
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Constant-time string compare. Mirrors position_estimator + rules_engine. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  // Item 81: require service-role bearer on every request.
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const expected = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (auth == null || !timingSafeEqual(auth, expected)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body: BridgePayload;
  try {
    body = (await req.json()) as BridgePayload;
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const outcome = await processMessage(body.topic, body.message, supabase, {
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  });

  if (outcome.persisted) return json(outcome, 202);
  // Validation failures get 400 so the mock generator (or firmware) can
  // surface a meaningful error; deferred-persist outcomes (signals,
  // events, phase-2/phase-4) get 202 — accepted, not persisted by design.
  const isValidationFail =
    ('error' in outcome && outcome.error === 'validation') ||
    ('reason' in outcome && outcome.reason === 'validation');
  return json(outcome, isValidationFail ? 400 : outcome.kind === 'unknown' ? 400 : 202);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
