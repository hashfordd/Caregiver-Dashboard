import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
      'Copy apps/web/.env.example to apps/web/.env.local and fill in the values.',
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey);
