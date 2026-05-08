// HTTP entry point for rules_engine. Triggered by Supabase database
// webhooks on INSERT into sensor_readings, position_estimates, events.
// The orchestration logic lives in handler.ts so it can be unit-tested
// against a mocked Supabase client (mirrors mqtt_bridge / position_estimator).
//
// CROSS_CUTTING §1: this entry holds the service-role key in env and
// never exposes it to clients. The handler additionally compares the
// incoming Authorization header against the same key — webhook
// invocations include `Authorization: Bearer <SERVICE_ROLE_KEY>` per
// supabase/config.toml's `[functions.rules_engine] verify_jwt = false`
// (Supabase's webhook surface doesn't carry a user JWT).

import { createClient } from '@supabase/supabase-js';
import { handleRulesEngineRequest } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'rules_engine: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    }),
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req: Request) =>
  handleRulesEngineRequest(req, supabase, { serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }),
);
