// HTTP entry point for inactivity_scan. Triggered by pg_cron every 60 s
// (configured in the F11 schedule migration). Loops over enabled
// inactivity rules and writes alerts.
//
// Auth pattern matches rules_engine: `Authorization: Bearer
// <SUPABASE_SERVICE_ROLE_KEY>` injected by the cron job's net.http_post.

import { createClient } from '@supabase/supabase-js';
import { handleInactivityScan } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'inactivity_scan: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    }),
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req: Request) =>
  handleInactivityScan(req, supabase, { serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }),
);
