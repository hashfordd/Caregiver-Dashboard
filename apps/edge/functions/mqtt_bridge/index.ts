// HTTP entry point for the mqtt_bridge. Used by CI tests and (optionally) by
// the mock telemetry generator running in `--mode bridge` against a locally
// served Supabase function. The validation + persistence logic is owned by
// the shared `processMessage` module so the eventual long-running MQTT
// subscriber (Phase 1 closure — see BACKLOG) calls the same code path.
//
// CROSS_CUTTING §1: this entry holds the service-role key in env and never
// exposes it to clients.
// CROSS_CUTTING §11: shared SSOT between HTTP and long-running runtimes.

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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: BridgePayload;
  try {
    body = (await req.json()) as BridgePayload;
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const outcome = await processMessage(body.topic, body.message, supabase);

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
