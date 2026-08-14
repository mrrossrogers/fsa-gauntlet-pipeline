// api/list-articles.js
// GET /api/list-articles
// Returns every article, lightweight (no draft/image_brief/critique_log bodies —
// use get-article.js for the full record). Dashboard groups these client-side.

import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('fsa_articles')
      .select('id, category, status, issue, brief, final_decision, final_notes, draft_round, image_round, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const rows = data.map(a => ({
      ...a,
      title: a.brief?.title_working || a.brief?.subject || '(untitled — pre-brief)',
      brief: undefined,
    }));

    return res.status(200).json({ articles: rows });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
