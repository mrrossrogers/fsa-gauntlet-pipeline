// api/scout-candidates.js
// POST /api/scout-candidates
// On-demand: generates a batch of candidate ideas (3 per category, 9 total)
// via the Scout agent and inserts them into fsa_content_candidates with
// source: 'scout' -- they land in the Content Funnel tab for human review,
// same approve/reject flow as manually-added candidates. Nothing here
// bypasses the Assignment Editor's gate once approved into the gauntlet.

import { getSupabase } from '../lib/supabase.js';
import { callClaude } from '../lib/claude.js';
import { SCOUT } from '../lib/prompts.js';

const CATEGORIES = ['food', 'sex', 'alcohol'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const { issue } = req.body || {};
    const targetIssue = issue || 'current';

    // 9 candidates with a real seed + angle each run well past the 4096-token
    // default used elsewhere in the pipeline (which is sized for single-item
    // responses like a draft or one critique) -- give this call real headroom.
    const result = await callClaude(SCOUT, JSON.stringify({ issue: targetIssue }), { maxTokens: 8192 });
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];

    const rows = candidates
      .filter(c => c && CATEGORIES.includes(c.category) && c.seed)
      .map(c => ({
        category: c.category,
        seed: c.seed,
        angle: c.angle || null,
        issue: targetIssue,
        source: 'scout',
      }));

    if (!rows.length) {
      return res.status(500).json({ error: 'Scout returned no usable candidates', raw: result });
    }

    const { data, error } = await supabase.from('fsa_content_candidates').insert(rows).select();
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ added: data.length, candidates: data });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
