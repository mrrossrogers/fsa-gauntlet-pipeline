// api/add-candidate.js
// POST /api/add-candidate
// { "seed": "...", "angle": "...", "issue": "..." }
// This is the manual side of the content funnel. The Scout agent
// (api/scout-candidates.js) inserts rows here too, with source: 'scout' and
// its own category already chosen -- the queue and the approve flow don't
// change either way. Manual candidates get category classified the same way
// as a direct submission (see api/submit-idea.js): no picker, the
// Categorizer agent reads the seed text.

import { getSupabase } from '../lib/supabase.js';
import { callClaude } from '../lib/claude.js';
import { CATEGORIZER } from '../lib/prompts.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const { seed, angle, issue } = req.body || {};
    if (!seed) return res.status(400).json({ error: 'seed is required' });

    const { category } = await callClaude(CATEGORIZER, JSON.stringify({ seed, angle }));
    if (!['food', 'sex', 'alcohol'].includes(category)) {
      throw new Error(`Categorizer returned an unexpected category: ${JSON.stringify(category)}`);
    }

    const { data, error } = await supabase.from('fsa_content_candidates').insert({
      category, seed, angle: angle || null, issue: issue || 'current', source: 'manual',
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ id: data.id, category: data.category });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
