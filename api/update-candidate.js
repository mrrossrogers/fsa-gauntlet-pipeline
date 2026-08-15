import { requireOwner } from "../lib/auth.js";
import { cleanText, getSupabase, validCategory } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;
  const body = req.body || {};
  const id = cleanText(body.id, 100);
  const action = cleanText(body.action, 30).toLowerCase();
  if (!id || !action) return res.status(400).json({ error: "Candidate id and action are required." });

  try {
    const supabase = getSupabase();
    const { data: candidate, error: readError } = await supabase.from("fsa_content_candidates").select("*").eq("id", id).single();
    if (readError || !candidate) return res.status(404).json({ error: "Candidate not found." });

    if (action === "approve") {
      if (candidate.approved_article_id) return res.status(200).json({ articleId: candidate.approved_article_id, status: "approved" });
      const sourceNotes = [
        candidate.scorecard?.reporting_path ? `Reporting path: ${candidate.scorecard.reporting_path}` : "",
        candidate.scorecard?.originality_risk ? `Originality risk: ${candidate.scorecard.originality_risk}` : "",
      ].filter(Boolean).join("\n");
      const { data: article, error: insertError } = await supabase.from("fsa_articles").insert({
        category: candidate.category,
        seed: candidate.seed,
        angle: candidate.angle,
        issue: candidate.issue,
        source_notes: sourceNotes || null,
        status: "submitted",
      }).select("id").single();
      if (insertError) throw insertError;
      const { error: updateError } = await supabase.from("fsa_content_candidates").update({
        status: "approved",
        approved_article_id: article.id,
      }).eq("id", id).is("approved_article_id", null);
      if (updateError) throw updateError;
      return res.status(201).json({ articleId: article.id, status: "approved" });
    }

    if (["park", "reject"].includes(action)) {
      const status = action === "park" ? "parked" : "rejected";
      const { error } = await supabase.from("fsa_content_candidates").update({ status }).eq("id", id);
      if (error) throw error;
      return res.status(200).json({ id, status });
    }

    if (action === "edit") {
      const category = cleanText(body.category, 20).toLowerCase();
      const seed = cleanText(body.seed, 1200);
      if (!validCategory(category) || !seed) return res.status(400).json({ error: "Category and seed are required." });
      const scorecard = {
        ...(candidate.scorecard || {}),
        reader_question: cleanText(body.readerQuestion, 700),
        reader_promise: cleanText(body.readerPromise, 700),
        reporting_path: cleanText(body.reportingPath, 1200),
        originality_risk: cleanText(body.originalityRisk, 700),
        visual_opportunity: cleanText(body.visualOpportunity, 700),
      };
      const { data, error } = await supabase.from("fsa_content_candidates").update({
        category,
        seed,
        angle: cleanText(body.angle, 2000) || null,
        issue: cleanText(body.issue, 120) || candidate.issue,
        scorecard,
        status: "pending",
      }).eq("id", id).select().single();
      if (error) throw error;
      return res.status(200).json({ candidate: data });
    }

    return res.status(400).json({ error: "Unknown candidate action." });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to update the candidate." });
  }
}


