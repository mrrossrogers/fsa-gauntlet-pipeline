// api/submit-idea.js
// The only manual step. POST here with your idea; everything else is automatic.
//
// POST body: { "category": "food"|"sex"|"alcohol", "seed": "...", "angle": "...", "issue": "..." }

import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const { category, seed, angle, issue } = req.body || {};

    if (!category || !['food', 'sex', 'alcohol'].includes(category)) {
      return res.status(400).json({ error: 'category must be food, sex, or alcohol' });
    }
    if (!seed) return res.status(400).json({ error: 'seed is required' });

    const { data, error } = await supabase.from('fsa_articles').insert({
      category, seed, angle: angle || null, issue: issue || 'current', status: 'submitted',
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ id: data.id, status: data.status });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
