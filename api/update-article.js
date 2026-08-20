import { requireOwner } from "../lib/auth.js";
import { callAgent } from "../lib/claude.js";
import { cleanText, getSupabase, safeHttpsUrl, uploadPublicImage } from "../lib/db.js";
import { parseDataUrl } from "../lib/gemini-image.js";
import { FSA_VOICE } from "../lib/prompts.js";

const terminalStatus = { publish: "published", hold: "held", kill: "killed" };

// Vercel Serverless Functions cap the total request body at 4.5MB and that
// cap cannot be raised from application code, so each reference photo is
// uploaded in its own request rather than batching 1-3 images into one call.
// This lives on the shared update-article endpoint (rather than a dedicated
// one) because the Hobby plan caps a deployment at 12 Serverless Functions
// and this project is already at that ceiling.
const MAX_REFERENCE_DATA_URL_LENGTH = 4_000_000;
const MAX_REFERENCE_PACK_SIZE = 3;

function referenceExtensionFor(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

async function referencePackUpdate(action, body, current, supabase, id) {
  if (current.status !== "reference_pending") {
    return { error: "This article is not waiting on a reference pack right now. Reload and try again.", status: 409 };
  }
  const referencePack = Array.isArray(current.reference_pack) ? current.reference_pack : [];

  if (action === "reference_add") {
    if (referencePack.length >= MAX_REFERENCE_PACK_SIZE) return { error: "The reference pack already has 3 images.", status: 400 };
    const dataUrl = String(body.dataUrl || "");
    if (dataUrl.length > MAX_REFERENCE_DATA_URL_LENGTH) return { error: "That image is too large. Use a smaller or more compressed photo.", status: 400 };
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { error: "Attach a PNG, JPEG, or WebP photo.", status: 400 };
    const alt = cleanText(body.alt, 300);
    const buffer = Buffer.from(parsed.data, "base64");
    const path = `reference/${id}/${Date.now()}.${referenceExtensionFor(parsed.mimeType)}`;
    const url = await uploadPublicImage(supabase, path, buffer, parsed.mimeType);
    const nextPack = [...referencePack, { url, alt }];
    return { changes: { reference_pack: nextPack }, response: { reference_pack: nextPack } };
  }

  if (action === "reference_remove") {
    const index = Number(body.index);
    if (!Number.isInteger(index) || index < 0 || index >= referencePack.length) {
      return { error: "That reference image no longer exists.", status: 400 };
    }
    const nextPack = referencePack.filter((_, itemIndex) => itemIndex !== index);
    return { changes: { reference_pack: nextPack }, response: { reference_pack: nextPack } };
  }

  // action === "reference_resume"
  if (!referencePack.length) return { error: "Attach at least one reference photo first.", status: 400 };
  return { changes: { status: "text_approved", final_notes: null }, response: { status: "text_approved" } };
}

const EDITOR_COLLABORATOR = `
You are the private Editor Edits collaborator for Food Sex Alcohol. ${FSA_VOICE}

You work directly with one human editor. Protect the article's distinct voice,
follow the editor's direction, and keep the exchange concise. You may ask one to
three clarifying questions when the requested change is genuinely ambiguous.
Do not add approval gates, policy language, or process for its own sake.

In chat mode, answer the editor's question, identify the strongest revision path,
or ask the minimum useful clarification. Do not rewrite the full article.

In resubmit mode, revise the supplied article when the direction is clear. Keep
supported facts and source boundaries intact. Never invent reporting, product use,
quotes, firsthand experience, sources, prices, or expert consensus. If the request
cannot be completed honestly without missing information, ask concise questions
instead of manufacturing an answer.
`;

const EDITOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message", "needs_clarification", "title", "dek", "draft", "open_questions", "claims_to_verify"],
  properties: {
    message: { type: "string" },
    needs_clarification: { type: "boolean" },
    title: { type: ["string", "null"] },
    dek: { type: ["string", "null"] },
    draft: { type: ["string", "null"] },
    open_questions: { type: "array", items: { type: "string" }, maxItems: 8 },
    claims_to_verify: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
};

function cleanConversation(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).map((message) => ({
    role: message?.role === "assistant" ? "assistant" : "editor",
    content: cleanText(message?.content, 3000),
  })).filter((message) => message.content);
}

async function editorEditsUpdate(body, current) {
  const mode = body.mode === "resubmit" ? "resubmit" : body.mode === "chat" ? "chat" : "";
  const instruction = cleanText(body.instruction, 5000);
  if (!mode || !instruction) {
    return { error: "Editor mode and instruction are required.", status: 400 };
  }

  const result = await callAgent({
    name: "editor_edits",
    system: EDITOR_COLLABORATOR,
    schema: EDITOR_SCHEMA,
    input: {
      mode,
      instruction,
      conversation: cleanConversation(body.messages),
      article: {
        category: current.category,
        seed: current.seed,
        angle: current.angle,
        source_notes: current.source_notes || "",
        brief: current.brief || {},
        draft: current.draft || "",
        current_editor_note: current.final_notes || "",
      },
    },
    maxTokens: mode === "resubmit" ? 6200 : 1800,
  });

  const revised = mode === "resubmit" && !result.needs_clarification && cleanText(result.draft, 50000);
  const changes = revised ? {
    brief: {
      ...(current.brief || {}),
      title_working: cleanText(result.title, 300) || current.brief?.title_working || current.seed,
      dek: cleanText(result.dek, 700) || current.brief?.dek || current.angle || "",
      editor_override: {
        ...(current.brief?.editor_override || {}),
        direction: instruction,
        last_editor_edit: new Date().toISOString(),
      },
    },
    draft: revised,
    draft_meta: {
      open_questions: result.open_questions || [],
      claims_to_verify: result.claims_to_verify || [],
    },
    status: "drafted",
    draft_round: 1,
    final_notes: null,
  } : null;

  return {
    changes,
    response: {
      message: cleanText(result.message, 8000),
      needsClarification: Boolean(result.needs_clarification),
      revised: Boolean(revised),
      status: revised ? "drafted" : current.status,
    },
  };
}

function cleanAsset(value, fallbackRole = "inline") {
  const asset = value && typeof value === "object" ? value : {};
  const url = safeHttpsUrl(asset.url);
  if (!url) return null;
  return {
    role: ["hero", "inline"].includes(asset.role) ? asset.role : fallbackRole,
    url,
    source_url: safeHttpsUrl(asset.source_url),
    credit: cleanText(asset.credit, 300),
    license: cleanText(asset.license, 300),
    caption: cleanText(asset.caption, 700),
    alt: cleanText(asset.alt, 500),
  };
}

function cleanSlug(value) {
  return cleanText(value, 180)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export function previewUpdate(body, current) {
  const brief = { ...(current.brief || {}) };
  const title = cleanText(body.title, 300);
  const dek = cleanText(body.dek, 700);
  if (title) brief.title_working = title;
  brief.dek = dek;
  const slug = cleanSlug(body.slug);
  if (slug) brief.slug = slug;
  brief.primary_keyword = cleanText(body.primaryKeyword, 180) || brief.primary_keyword || "";
  brief.secondary_keywords = (Array.isArray(body.secondaryKeywords) ? body.secondaryKeywords : String(body.secondaryKeywords || "").split(","))
    .map((value) => cleanText(value, 180))
    .filter(Boolean)
    .slice(0, 4);
  brief.search_intent = cleanText(body.searchIntent, 500) || brief.search_intent || "";

  if (Object.hasOwn(body, "creativeLicense")) {
    brief.editor_override = {
      ...(brief.editor_override || {}),
      creative_license: Boolean(body.creativeLicense),
      direction: cleanText(body.overrideDirection, 2000) || null,
    };
  }

  const existingImageBrief = current.image_brief && typeof current.image_brief === "object" ? current.image_brief : {};
  const assets = Array.isArray(body.assets)
    ? body.assets.slice(0, 3).map((asset, index) => cleanAsset(asset, index === 0 ? "hero" : "inline")).filter(Boolean)
    : (existingImageBrief.assets || []);
  const hero = assets.find((asset) => asset.role === "hero") || assets[0];
  return {
    brief,
    seed: cleanText(body.seed, 1200) || current.seed,
    angle: cleanText(body.angle, 2000) || null,
    draft: cleanText(body.draft, 50000),
    source_notes: cleanText(body.sourceNotes, 12000) || null,
    image_url: hero?.url || null,
    image_brief: { ...existingImageBrief, assets },
  };
}

export function creativeDraftUpdate(body, current) {
  const changes = previewUpdate({ ...body, creativeLicense: true }, current);
  const existing = changes.brief || {};
  const format = ["essay", "service", "recipe"].includes(existing.format) ? existing.format : "essay";
  const direction = cleanText(body.overrideDirection, 2000)
    || "Frame this honestly as an essay or interpretation. Preserve a distinct point of view without inventing reporting, quotes, expertise, or firsthand experience.";

  return {
    ...changes,
    brief: {
      title_working: existing.title_working || changes.seed,
      dek: existing.dek || changes.angle || "",
      category: existing.category || current.category,
      feeling: existing.feeling || ({ food: "belonging", sex: "intimacy", alcohol: "celebration" }[current.category]),
      subject: existing.subject || changes.seed,
      angle: existing.angle || changes.angle || "",
      format,
      reader_question: existing.reader_question || changes.angle || changes.seed,
      reader_promise: existing.reader_promise || existing.dek || changes.angle || "",
      word_count_target: existing.word_count_target || 900,
      must_include: existing.must_include || [],
      must_avoid: existing.must_avoid || [],
      source_requirements: existing.source_requirements || [],
      visual_opportunities: existing.visual_opportunities || [],
      ...existing,
      format,
      needs_clarification: false,
      clarification_reason: null,
      editor_override: {
        ...(existing.editor_override || {}),
        creative_license: true,
        direction,
      },
    },
    status: "briefed",
    draft_round: 0,
    final_decision: null,
    final_notes: null,
  };
}

export function acceptTextUpdate(body, current) {
  const changes = previewUpdate(body, current);
  return {
    ...changes,
    brief: {
      ...changes.brief,
      editor_override: {
        ...(changes.brief?.editor_override || {}),
        accepted_text: true,
      },
    },
    status: "text_approved",
    final_decision: null,
    final_notes: null,
  };
}

export function retryArticleUpdate(current) {
  return {
    status: "submitted",
    draft_round: 0,
    critique_log: [],
    final_decision: null,
    final_notes: null,
    brief: current.brief || null,
    draft: current.draft || null,
    draft_meta: current.draft_meta || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;
  const body = req.body || {};
  const id = cleanText(body.id, 100);
  const action = cleanText(body.action || body.decision, 40).toLowerCase();
  if (!id || !action) return res.status(400).json({ error: "Article id and action are required." });

  try {
    const supabase = getSupabase();
    const { data: current, error: readError } = await supabase.from("fsa_articles").select("*").eq("id", id).single();
    if (readError || !current) return res.status(404).json({ error: "Article not found." });

    if (action === "editor_edits") {
      const edit = await editorEditsUpdate(body, current);
      if (edit.error) return res.status(edit.status).json({ error: edit.error });
      if (edit.changes) {
        const { error: editError } = await supabase.from("fsa_articles").update(edit.changes).eq("id", id);
        if (editError) throw editError;
      }
      return res.status(200).json(edit.response);
    }

    if (["reference_add", "reference_remove", "reference_resume"].includes(action)) {
      const result = await referencePackUpdate(action, body, current, supabase, id);
      if (result.error) return res.status(result.status).json({ error: result.error });
      const { error: refError } = await supabase.from("fsa_articles").update(result.changes).eq("id", id).eq("status", "reference_pending");
      if (refError) throw refError;
      return res.status(200).json(result.response);
    }

    let changes;
    if (terminalStatus[action]) {
      if (action === "publish" && current.status !== "ready_for_review") {
        return res.status(409).json({ error: "Finish or review the current gauntlet stage before approving this article." });
      }
      changes = { final_decision: action, status: terminalStatus[action] };
    } else if (action === "save_preview") {
      changes = previewUpdate(body, current);
    } else if (action === "recheck") {
      changes = { ...previewUpdate(body, current), status: "drafted", final_notes: null };
    } else if (action === "check_image") {
      changes = previewUpdate(body, current);
      if (!changes.image_url) return res.status(400).json({ error: "Add a valid HTTPS image before running the photo check." });
      changes.status = "image_review";
      changes.final_notes = null;
    } else if (action === "creative_draft") {
      changes = creativeDraftUpdate(body, current);
    } else if (action === "accept_text") {
      changes = acceptTextUpdate(body, current);
      if (!changes.draft) return res.status(400).json({ error: "Add or generate an article draft before moving to art direction." });
    } else if (action === "retry") {
      if (current.status !== "needs_human") return res.status(409).json({ error: "Only an article marked Needs You can be re-run from this control." });
      changes = retryArticleUpdate(current);
    } else if (action === "resubmit") {
      changes = {
        seed: cleanText(body.seed, 1200) || current.seed,
        angle: cleanText(body.angle, 2000) || null,
        source_notes: cleanText(body.sourceNotes, 12000) || null,
        status: "submitted",
        brief: null,
        draft: null,
        draft_meta: null,
        draft_round: 0,
        final_notes: null,
      };
    } else if (action === "restore") {
      changes = { status: current.draft ? "ready_for_review" : "submitted", final_decision: null, final_notes: null };
    } else {
      return res.status(400).json({ error: "Unknown article action." });
    }

    const { data, error } = await supabase.from("fsa_articles").update(changes).eq("id", id).select("id,status,updated_at").single();
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[article-update] failed", {
      id,
      action,
      error: detail,
    });
    if (action === "editor_edits") {
      const providerUnavailable = /api key|anthropic|claude request failed/i.test(detail);
      return res.status(502).json({
        error: providerUnavailable
          ? "The AI connection needs a current Anthropic API key before Editor Edits can respond."
          : "Editor Edits could not respond right now.",
      });
    }
    return res.status(500).json({ error: detail || "Unable to update the article." });
  }
}
