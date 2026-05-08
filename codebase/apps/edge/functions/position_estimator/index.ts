// HTTP entry point for position_estimator. Triggered by mqtt_bridge
// after it validates a SignalsMessage. The orchestration logic lives
// in handler.ts so it can be unit-tested against a mocked Supabase
// client (mirrors mqtt_bridge/processMessage.ts).
//
// CROSS_CUTTING §1: this entry holds the service-role key in env and
// never exposes it to clients. The handler additionally compares the
// incoming Authorization header against the same key as defence-in-depth
// — `verify_jwt = true` in supabase/config.toml is the first line of
// defence.

import { createClient } from '@supabase/supabase-js';
import { handlePositionEstimateRequest } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'position_estimator: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    }),
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req: Request) =>
  handlePositionEstimateRequest(req, supabase, { serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }),
);
