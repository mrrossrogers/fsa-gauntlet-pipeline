// lib/supabase.js
// Shared Supabase client factory. Every api/*.js handler calls this INSIDE
// its handler function (not at module load time) so that a missing env var
// produces a normal JSON 500 response instead of crashing the whole
// serverless function before it can respond — that crash is what causes
// Vercel's generic HTML error page to come back instead of JSON, which is
// what broke the dashboard originally.

import { createClient } from '@supabase/supabase-js';

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_KEY'].filter(Boolean).join(', ');
    throw new Error(`Missing required env var(s): ${missing}`);
  }
  return createClient(url, key);
}
