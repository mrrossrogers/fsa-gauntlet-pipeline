import { requireOwner } from "../lib/auth.js";
import { callAgent } from "../lib/claude.js";
import { cleanText, getSupabase, normalizeCandidate } from "../lib/db.js";
import { AGENT_SCHEMAS, SCOUT_EDITOR } from "../lib/prompts.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;

  try {
    const supabase = getSupabase();
    const [{ data: candidates, error: candidateError }, { data: articles, error: articleError }] = await Promise.all([
      supabase.from("fsa_content_candidates").select("seed,angle,category,status").order("created_at", { ascending: false }).limit(120),
      supabase.from("fsa_articles").select("seed,angle,category,status").order("created_at", { ascending: false }).limit(80),
    ]);
    if (candidateError) throw candidateError;
    if (articleError) throw articleError;

    const requested = Math.min(12, Math.max(3, Number(req.body?.count) || 9));
    const result = await callAgent({
      name: "candidate_scout",
      system: SCOUT_EDITOR,
      schema: AGENT_SCHEMAS.scout,
      input: {
        requested_count: requested,
        issue: cleanText(req.body?.issue, 120) || "current",
        existing_candidates: candidates,
        existing_articles: articles,
      },
      maxTokens: 4200,
    });

    const existing = new Set([...candidates, ...articles].map((item) => normalizeCandidate(item.seed)));
    const seen = new Set();
    const rows = result.candidates
      .filter((candidate) => {
        const key = normalizeCandidate(candidate.seed);
        if (!key || existing.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, requested)
      .map((candidate) => ({
        category: candidate.category,
        // Defensive normalize: the schema allows the model to set
        // secondary_category, but never trust it blindly if it happens to
        // match the primary category (one room must stay prominent).
        secondary_category: candidate.secondary_category && candidate.secondary_category !== candidate.category ? candidate.secondary_category : null,
        seed: cleanText(candidate.seed, 1200),
        angle: cleanText(candidate.angle, 2000),
        source: "scout",
        issue: cleanText(req.body?.issue, 120) || "current",
        status: "pending",
        scorecard: {
          reader_question: cleanText(candidate.reader_question, 700),
          reader_promise: cleanText(candidate.reader_promise, 700),
          reporting_path: cleanText(candidate.reporting_path, 1200),
          originality_risk: cleanText(candidate.originality_risk, 700),
          visual_opportunity: cleanText(candidate.visual_opportunity, 700),
        },
      }));

    if (!rows.length) return res.status(200).json({ added: 0, message: "The scout did not find a sufficiently distinct candidate this round." });
    const { data, error } = await supabase.from("fsa_content_candidates").insert(rows).select("id");
    if (error) throw error;
    return res.status(201).json({ added: data.length });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "The scout could not complete this round." });
  }
}


