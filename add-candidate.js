// api/add-candidate.js
// POST /api/add-candidate
// { "category": "food"|"sex"|"alcohol", "seed": "...", "angle": "...", "issue": "..." }
// This is the manual side of the content funnel today. When a Scout agent
// exists, it inserts rows here too (with source: 'scout') — the queue and
// the approve flow don't change either way.

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { category, seed, angle, issue } = req.body || {};

  if (!category || !['food', 'sex', 'alcohol'].includes(category)) {
    return res.status(400).json({ error: 'category must be food, sex, or alcohol' });
  }
  if (!seed) return res.status(400).json({ error: 'seed is required' });

  const { data, error } = await supabase.from('fsa_content_candidates').insert({
    category, seed, angle: angle || null, issue: issue || 'current', source: 'manual',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ id: data.id });
}
