// api/update-article.js
// POST /api/update-article
// { "id": "<uuid>", "decision": "publish"|"hold"|"kill" }
// Only meaningful from status: ready_for_review or needs_human — this is the
// Editor-in-Chief call, made by you via the dashboard rather than an agent.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const STATUS_FOR = { publish: 'published', hold: 'held', kill: 'killed' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id, decision } = req.body || {};

  if (!id) return res.status(400).json({ error: 'id is required' });
  if (!STATUS_FOR[decision]) return res.status(400).json({ error: 'decision must be publish, hold, or kill' });

  const { data, error } = await supabase
    .from('fsa_articles')
    .update({ final_decision: decision, status: STATUS_FOR[decision] })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ id: data.id, status: data.status });
}
