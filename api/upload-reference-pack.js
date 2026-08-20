import { requireOwner } from "../lib/auth.js";
import { cleanText, getSupabase, uploadPublicImage } from "../lib/db.js";
import { parseDataUrl } from "../lib/gemini-image.js";

// Vercel Serverless Functions cap the total request body at 4.5MB and that
// cap cannot be raised from application code, so each reference photo is
// uploaded in its own request rather than batching 1-3 images into one call.
// This limit leaves headroom under that cap for a single base64 image plus
// the JSON envelope around it.
const MAX_DATA_URL_LENGTH = 4_000_000;
const MAX_PACK_SIZE = 3;

function extensionFor(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;

  const body = req.body || {};
  const id = cleanText(body.id, 100);
  const action = cleanText(body.action, 20);
  if (!id) return res.status(400).json({ error: "An article id is required." });
  if (!["add", "remove", "resume"].includes(action)) return res.status(400).json({ error: "Unknown action." });

  try {
    const supabase = getSupabase();
    const { data: article, error } = await supabase
      .from("fsa_articles")
      .select("id,status,reference_pack")
      .eq("id", id)
      .single();
    if (error || !article) return res.status(404).json({ error: "Article not found." });
    if (article.status !== "reference_pending") {
      return res.status(409).json({ error: "This article is not waiting on a reference pack right now. Reload and try again." });
    }
    const referencePack = Array.isArray(article.reference_pack) ? article.reference_pack : [];

    if (action === "add") {
      if (referencePack.length >= MAX_PACK_SIZE) return res.status(400).json({ error: "The reference pack already has 3 images." });
      const dataUrl = String(body.dataUrl || "");
      if (dataUrl.length > MAX_DATA_URL_LENGTH) return res.status(400).json({ error: "That image is too large. Use a smaller or more compressed photo." });
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return res.status(400).json({ error: "Attach a PNG, JPEG, or WebP photo." });
      const alt = cleanText(body.alt, 300);
      const buffer = Buffer.from(parsed.data, "base64");
      const path = `reference/${id}/${Date.now()}.${extensionFor(parsed.mimeType)}`;
      const url = await uploadPublicImage(supabase, path, buffer, parsed.mimeType);
      const nextPack = [...referencePack, { url, alt }];
      const { error: updateError } = await supabase
        .from("fsa_articles")
        .update({ reference_pack: nextPack })
        .eq("id", id)
        .eq("status", "reference_pending");
      if (updateError) throw updateError;
      return res.status(200).json({ reference_pack: nextPack });
    }

    if (action === "remove") {
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= referencePack.length) {
        return res.status(400).json({ error: "That reference image no longer exists." });
      }
      const nextPack = referencePack.filter((_, itemIndex) => itemIndex !== index);
      const { error: updateError } = await supabase
        .from("fsa_articles")
        .update({ reference_pack: nextPack })
        .eq("id", id)
        .eq("status", "reference_pending");
      if (updateError) throw updateError;
      return res.status(200).json({ reference_pack: nextPack });
    }

    // action === "resume"
    if (!referencePack.length) return res.status(400).json({ error: "Attach at least one reference photo first." });
    const { data: resumed, error: resumeError } = await supabase
      .from("fsa_articles")
      .update({ status: "text_approved", final_notes: null })
      .eq("id", id)
      .eq("status", "reference_pending")
      .select("id,status")
      .maybeSingle();
    if (resumeError) throw resumeError;
    if (!resumed) return res.status(409).json({ error: "This article changed while you were working. Reload and try again." });
    return res.status(200).json({ status: resumed.status });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to update the reference pack." });
  }
}
