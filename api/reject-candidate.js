// api/reject-candidate.js
// POST /api/reject-candidate  { "id": "<candidate uuid>" }

import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { error } = await supabase.from('fsa_content_candidates')
      .update({ status: 'rejected' }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ id, status: 'rejected' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
