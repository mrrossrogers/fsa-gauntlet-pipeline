// api/list-candidates.js
// GET /api/list-candidates — pending candidates by default, or ?status=all

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const wantAll = req.query.status === 'all';

  let query = supabase.from('fsa_content_candidates').select('*').order('created_at', { ascending: false });
  if (!wantAll) query = query.eq('status', 'pending');

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ candidates: data });
}
