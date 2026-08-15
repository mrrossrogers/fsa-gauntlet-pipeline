import { requireOwner } from "../lib/auth.js";
import { cleanText, getSupabase, validCategory } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;
  const body = req.body || {};
  const category = cleanText(body.category, 20).toLowerCase();
  const seed = cleanText(body.seed, 1200);
  if (!validCategory(category) || !seed) return res.status(400).json({ error: "Category and seed are required." });

  try {
    const scorecard = {
      reader_question: cleanText(body.readerQuestion, 700),
      reader_promise: cleanText(body.readerPromise, 700),
      reporting_path: cleanText(body.reportingPath, 1200),
      originality_risk: cleanText(body.originalityRisk, 700),
      visual_opportunity: cleanText(body.visualOpportunity, 700),
    };
    const { data, error } = await getSupabase().from("fsa_content_candidates").insert({
      category,
      seed,
      angle: cleanText(body.angle, 2000) || null,
      source: "manual",
      issue: cleanText(body.issue, 120) || "current",
      scorecard,
      status: "pending",
    }).select().single();
    if (error) throw error;
    return res.status(201).json({ candidate: data });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to add the candidate." });
  }
}


