// lib/supabaseAdmin.js
// Server-side Supabase admin client. Use ONLY in API routes / server-side code.
// Requires:
// - NEXT_PUBLIC_SUPABASE_URL (public) - used as the URL
// - SUPABASE_SERVICE_ROLE_KEY (server-only) - service role key, must NOT be exposed to browser

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  // Fail early on misconfiguration when imported in server code
  // eslint-disable-next-line no-console
  console.warn('Supabase admin client misconfigured. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  // use a short timeout in serverless environments
  fetch: global.fetch,
});