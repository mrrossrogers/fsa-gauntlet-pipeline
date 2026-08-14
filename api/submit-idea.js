// api/submit-idea.js
// The only manual step. POST here with your idea; everything else is automatic,
// including the category -- the Categorizer agent classifies food/sex/alcohol
// from the seed text, no picker needed.
//
// POST body: { "seed": "...", "angle": "...", "issue": "..." }

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

    const { data, error } = await supabase.from('fsa_articles').insert({
      category, seed, angle: angle || null, issue: issue || 'current', status: 'submitted',
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ id: data.id, status: data.status, category: data.category });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
