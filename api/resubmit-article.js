// api/resubmit-article.js
// POST /api/resubmit-article
// { "id": "<uuid>", "seed": "...", "angle": "..." }
// For an article the Assignment Editor flagged (status: needs_human): apply
// the human's correction and send it back through the gauntlet from scratch.
// Same effect as killing it and submitting a fresh idea, but keeps the same
// article id/history instead of creating a duplicate row.

import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const { id, seed, angle } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!seed) return res.status(400).json({ error: 'seed is required' });

    const { data: existing, error: fetchErr } = await supabase
      .from('fsa_articles').select('status').eq('id', id).single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'article not found' });
    if (existing.status !== 'needs_human') {
      return res.status(400).json({
        error: `can only resubmit an article at needs_human (current status: ${existing.status})`,
      });
    }

    const { data, error } = await supabase.from('fsa_articles').update({
      seed,
      angle: angle || null,
      status: 'submitted',
      brief: null,
      draft: null,
      draft_round: 0,
      image_brief: null,
      image_url: null,
      image_round: 0,
      critique_log: [],
      final_decision: null,
      final_notes: null,
    }).eq('id', id).select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ id: data.id, status: data.status });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
