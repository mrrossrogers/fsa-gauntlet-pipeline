import { requireOwner } from "../lib/auth.js";
import { getSupabase } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store, max-age=0");

  try {
    const { data, error } = await getSupabase()
      .from("fsa_articles")
      .select("id,category,secondary_category,format_lane,seed,angle,status,issue,brief,final_decision,final_notes,draft_round,image_round,image_url,image_brief,draft_meta,site_url,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const articles = data.map((article) => ({
      id: article.id,
      category: article.category,
      secondary_category: article.secondary_category,
      format_lane: article.format_lane,
      seed: article.seed,
      angle: article.angle,
      status: article.status,
      issue: article.issue,
      title: article.brief?.title_working || article.brief?.subject || article.seed,
      dek: article.brief?.dek || article.brief?.reader_promise || "",
      recommendation: article.brief?.editor_recommendation || null,
      final_decision: article.final_decision,
      final_notes: article.final_notes,
      draft_round: article.draft_round,
      image_round: article.image_round,
      has_image: Boolean(article.image_url || article.image_brief?.assets?.length),
      site_url: article.site_url,
      image_review: article.image_brief?.photo_review || null,
      open_questions: article.draft_meta?.open_questions || [],
      claims_to_verify: article.draft_meta?.claims_to_verify || [],
      created_at: article.created_at,
      updated_at: article.updated_at,
    }));
    return res.status(200).json({ articles });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load articles." });
  }
}


