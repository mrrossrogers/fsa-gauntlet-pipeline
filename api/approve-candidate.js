// api/approve-candidate.js
// POST /api/approve-candidate  { "id": "<candidate uuid>" }
// Approving IS submitting — creates the fsa_articles row (status: submitted,
// same as /api/submit-idea) and marks the candidate approved, linked to it.

import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { data: candidate, error: fetchErr } = await supabase
      .from('fsa_content_candidates').select('*').eq('id', id).single();
    if (fetchErr || !candidate) return res.status(404).json({ error: 'candidate not found' });
    if (candidate.status !== 'pending') return res.status(400).json({ error: 'candidate already decided' });

    const { data: article, error: insertErr } = await supabase.from('fsa_articles').insert({
      category: candidate.category, seed: candidate.seed,
      angle: candidate.angle, issue: candidate.issue, status: 'submitted',
    }).select().single();
    if (insertErr) return res.status(500).json({ error: insertErr.message });

    await supabase.from('fsa_content_candidates')
      .update({ status: 'approved', approved_article_id: article.id })
      .eq('id', id);

    return res.status(200).json({ article_id: article.id, status: article.status });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
