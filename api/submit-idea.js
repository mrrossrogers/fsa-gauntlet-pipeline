import { requireOwner } from "../lib/auth.js";
import { cleanText, getSupabase, validCategory, validFormatLane } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;

  const body = req.body || {};
  const category = cleanText(body.category, 20).toLowerCase();
  const formatLane = cleanText(body.formatLane, 20).toLowerCase();
  const seed = cleanText(body.seed, 1200);
  const angle = cleanText(body.angle, 2000);
  const sourceNotes = cleanText(body.sourceNotes, 12000);
  const issue = cleanText(body.issue, 120) || "current";

  if (!validCategory(category)) return res.status(400).json({ error: "Choose Food, Sex, or Alcohol." });
  if (!validFormatLane(formatLane)) return res.status(400).json({ error: "Choose a format: Essay or Reported." });
  if (!seed) return res.status(400).json({ error: "A seed is required." });

  try {
    const { data, error } = await getSupabase().from("fsa_articles").insert({
      category,
      format_lane: formatLane,
      seed,
      angle: angle || null,
      source_notes: sourceNotes || null,
      issue,
      status: "submitted",
    }).select("id,status,category,format_lane").single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to create the article." });
  }
}
