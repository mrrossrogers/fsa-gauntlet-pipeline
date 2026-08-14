// api/process-article.js
// Vercel serverless function. Advances ONE article by ONE stage per invocation,
// then returns. Call it repeatedly (cron, or self-chaining) until the article
// reaches a terminal status (ready_for_review / needs_human / published / etc).
//
// POST body: { "id": "<article uuid>" }
// If no id is given, picks the oldest non-terminal article and processes it.

import { getSupabase } from '../lib/supabase.js';
import {
  ASSIGNMENT_EDITOR, CORRESPONDENT, FACT_SPECIFICITY_DESK,
  EDITORIAL_TEST_AUDITOR, CATEGORY_DESK, ART_DIRECTOR,
  PHOTO_CRITIC, EDITOR_IN_CHIEF,
} from '../lib/prompts.js';

const MAX_ROUNDS = 3;
const TERMINAL = ['ready_for_review', 'needs_human', 'published', 'held', 'killed'];

async function callClaude(system, userContent) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing required env var: ANTHROPIC_API_KEY');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  const data = await res.json();

  // Surface the real Anthropic error instead of falling through to an empty
  // string and a cryptic "Unexpected end of JSON input" from JSON.parse('').
  if (!res.ok) {
    throw new Error(`Anthropic API error (${res.status}): ${data.error?.message || JSON.stringify(data)}`);
  }

  const text = data.content?.map(b => b.text || '').join('\n') ?? '';
  const clean = text.replace(/```json|```/g, '').trim();
  if (!clean) {
    throw new Error(`Claude returned no parseable content. Raw response: ${JSON.stringify(data)}`);
  }

  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Claude response wasn't valid JSON: ${clean.slice(0, 500)}`);
  }
}

async function logCritique(article, stage, agent, verdict, notes, round) {
  const entry = { stage, agent, verdict, notes, round, at: new Date().toISOString() };
  return [...(article.critique_log || []), entry];
}

export default async function handler(req, res) {
  // Vercel Cron sends GET with no body — that's the "process the oldest pending
  // article" path. POST with a body {id} is for manual/self-chained triggers.
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  try {
    const supabase = getSupabase();

    let id = req.method === 'POST' ? (req.body || {}).id : undefined;
    if (!id) {
      const { data } = await supabase
        .from('fsa_articles').select('id')
        .not('status', 'in', `(${TERMINAL.join(',')})`)
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!data) return res.status(200).json({ message: 'nothing to process' });
      id = data.id;
    }

    const { data: article, error } = await supabase.from('fsa_articles').select('*').eq('id', id).single();
    if (error || !article) return res.status(404).json({ error: 'article not found' });

    switch (article.status) {

      case 'submitted': {
        const brief = await callClaude(ASSIGNMENT_EDITOR, JSON.stringify({
          category: article.category, seed: article.seed,
          angle: article.angle, issue: article.issue,
        }));
        if (brief.needs_clarification) {
          await supabase.from('fsa_articles').update({
            status: 'needs_human', final_notes: brief.clarification_reason,
          }).eq('id', id);
          break;
        }
        await supabase.from('fsa_articles').update({ brief, status: 'briefed' }).eq('id', id);
        break;
      }

      case 'briefed': {
        const { draft } = await callClaude(CORRESPONDENT, JSON.stringify({ brief: article.brief }));
        await supabase.from('fsa_articles').update({
          draft, status: 'drafted', draft_round: article.draft_round + 1,
        }).eq('id', id);
        break;
      }

      case 'drafted': {
        const [fact, aud, cat] = await Promise.all([
          callClaude(FACT_SPECIFICITY_DESK, article.draft),
          callClaude(EDITORIAL_TEST_AUDITOR, article.draft),
          callClaude(CATEGORY_DESK[article.category], article.draft),
        ]);
        let log = article.critique_log;
        log = await logCritique(article, 'text_critique', 'fact_specificity_desk', fact.verdict, fact.notes, article.draft_round);
        log = await logCritique({ ...article, critique_log: log }, 'text_critique', 'editorial_test_auditor', aud.verdict, aud.notes, article.draft_round);
        log = await logCritique({ ...article, critique_log: log }, 'text_critique', 'category_desk', cat.verdict, cat.notes, article.draft_round);

        const allPass = [fact, aud, cat].every(c => c.verdict === 'pass');
        const anyFail = [fact, aud, cat].some(c => c.verdict === 'fail');

        if (allPass) {
          await supabase.from('fsa_articles').update({ critique_log: log, status: 'text_approved' }).eq('id', id);
        } else if (anyFail || article.draft_round >= MAX_ROUNDS) {
          await supabase.from('fsa_articles').update({
            critique_log: log, status: 'needs_human',
            final_notes: 'Text critic round hit cap or hard fail.',
          }).eq('id', id);
        } else {
          await supabase.from('fsa_articles').update({ critique_log: log, status: 'briefed' }).eq('id', id); // back to Correspondent
        }
        break;
      }

      case 'text_approved': {
        const imgBrief = await callClaude(ART_DIRECTOR, JSON.stringify({ draft: article.draft, category: article.category }));
        // NOTE: plug in your actual image generation call here (e.g. an image model API).
        // This just stores the brief/prompt; wire image_url once generation is added.
        await supabase.from('fsa_articles').update({
          image_brief: imgBrief, status: 'image_drafted', image_round: article.image_round + 1,
        }).eq('id', id);
        break;
      }

      case 'image_drafted': {
        // Requires article.image_url to be populated by your image generation step.
        if (!article.image_url) {
          return res.status(200).json({ message: 'waiting on image generation to populate image_url' });
        }
        const photo = await callClaude(PHOTO_CRITIC, JSON.stringify({
          image_brief: article.image_brief, category: article.category,
        }));
        const log = await logCritique(article, 'image_critique', 'photo_critic', photo.verdict, photo.notes, article.image_round);

        if (photo.verdict === 'pass') {
          await supabase.from('fsa_articles').update({ critique_log: log, status: 'ready_for_review' }).eq('id', id);
        } else if (photo.verdict === 'fail' || article.image_round >= MAX_ROUNDS) {
          await supabase.from('fsa_articles').update({
            critique_log: log, status: 'needs_human', final_notes: 'Image critic hit cap or hard fail.',
          }).eq('id', id);
        } else {
          await supabase.from('fsa_articles').update({ critique_log: log, image_url: null, status: 'text_approved' }).eq('id', id); // regenerate
        }
        break;
      }

      default:
        return res.status(200).json({ message: `status '${article.status}' is terminal or unhandled — no action taken` });
    }

    const { data: updated } = await supabase.from('fsa_articles').select('status').eq('id', id).single();
    return res.status(200).json({ id, status: updated.status });

  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
