// api/list-candidates.js
// GET /api/list-candidates — pending candidates by default, or ?status=all

import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const wantAll = req.query.status === 'all';

    let query = supabase.from('fsa_content_candidates').select('*').order('created_at', { ascending: false });
    if (!wantAll) query = query.eq('status', 'pending');

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ candidates: data });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
