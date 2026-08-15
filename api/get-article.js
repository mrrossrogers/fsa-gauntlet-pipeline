import { requireOwner } from "../lib/auth.js";
import { buildArticlePackage } from "../lib/article-package.js";
import { cleanText, getSupabase } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const id = cleanText(req.query?.id, 100);
  if (!id) return res.status(400).json({ error: "An article id is required." });

  try {
    const { data, error } = await getSupabase().from("fsa_articles").select("*").eq("id", id).single();
    if (error || !data) return res.status(404).json({ error: "Article not found." });
    if (String(req.query?.format || "") === "package") {
      if (!data.draft) return res.status(409).json({ error: "The article needs a draft before a site package can be created." });
      return res.status(200).json(buildArticlePackage(data));
    }
    return res.status(200).json({ article: data });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load the article." });
  }
}

