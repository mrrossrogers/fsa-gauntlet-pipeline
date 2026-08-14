// api/get-article.js
// GET /api/get-article?id=<uuid>
// Full record: brief, draft, image_brief, critique_log, everything.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const { data, error } = await supabase.from('fsa_articles').select('*').eq('id', id).single();
  if (error || !data) return res.status(404).json({ error: 'not found' });

  return res.status(200).json({ article: data });
}
