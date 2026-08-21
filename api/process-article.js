import { requestHasCronSecret, requestIsOwner } from "../lib/auth.js";
import { callAgent } from "../lib/claude.js";
import { generateGeminiImage } from "../lib/gemini-image.js";
import { cleanText, getSupabase, uploadPublicImage } from "../lib/db.js";
import { findContentRegisterPageByUrl, findSimilarImageAssets, logGeneratedImage } from "../lib/notion.js";
import {
  AGENT_SCHEMAS,
  ART_DIRECTOR,
  ASSIGNMENT_EDITOR,
  CATEGORY_DESK,
  CORRESPONDENT,
  EDITORIAL_TEST_AUDITOR,
  EDITOR_IN_CHIEF,
  FACT_SPECIFICITY_DESK,
  PHOTO_CRITIC,
  RESEARCHER,
} from "../lib/prompts.js";

const MAX_ROUNDS = 3;
const TERMINAL = ["ready_for_review", "needs_human", "published", "held", "killed"];

function authorize(req, res) {
  if (requestIsOwner(req) || requestHasCronSecret(req)) return true;
  res.status(401).json({ error: "Owner session or cron secret required." });
  return false;
}

export function normalizedCritique(result) {
  const sourceVerdict = ["pass", "revise", "fail"].includes(result?.verdict) ? result.verdict : "revise";
  const notes = (Array.isArray(result?.notes) ? result.notes : []).map((note) => {
    let disposition = note?.disposition;
    if (!["block", "revision", "observation"].includes(disposition)) {
      if (sourceVerdict === "fail" && note?.severity === "blocking") disposition = "block";
      else if (["blocking", "major"].includes(note?.severity)) disposition = "revision";
      else disposition = "observation";
    }
    return { ...note, disposition };
  });
  const hasBlock = notes.some((note) => note.disposition === "block");
  const hasRevision = notes.some((note) => note.disposition === "revision" && ["blocking", "major"].includes(note.severity));
  const verdict = hasBlock ? "fail" : hasRevision ? "revise" : "pass";
  return { verdict, notes };
}

export function critiqueRoute(results, round) {
  const notes = results.flatMap((result) => result.notes || []);
  if (notes.some((note) => note.disposition === "block")) return "needs_human";
  const needsRevision = notes.some((note) => note.disposition === "revision" && ["blocking", "major"].includes(note.severity));
  if (needsRevision && Number(round) < MAX_ROUNDS) return "briefed";
  return "text_approved";
}

function appendCritique(log, stage, agent, result, round) {
  return [...(Array.isArray(log) ? log : []), {
    stage,
    agent,
    verdict: result.verdict,
    notes: result.notes,
    round,
    at: new Date().toISOString(),
  }];
}

async function updateAtStage(supabase, id, expectedStatus, changes) {
  const { data, error } = await supabase
    .from("fsa_articles")
    .update(changes)
    .eq("id", id)
    .eq("status", expectedStatus)
    .select("id,status")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This article changed while the gauntlet was working. Reload and continue from its current stage.");
  return data;
}

function latestRevisionNotes(article) {
  return (article.critique_log || [])
    .filter((entry) => entry.stage === "text_critique" && entry.round === article.draft_round)
    .map((entry) => ({ agent: entry.agent, verdict: entry.verdict, notes: entry.notes }));
}

function cleanArticleDraft(value) {
  const source = String(value || "").replace(/^\s*<draft>\s*/i, "");
  const artifact = source.search(/<\/draft>\s*<parameter\b|<parameter\s+name=/i);
  return (artifact >= 0 ? source.slice(0, artifact) : source).replace(/<\/draft>\s*$/i, "").trim();
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed." });
  if (!authorize(req, res)) return;

  let currentId = null;
  let currentStage = null;
  try {
    const supabase = getSupabase();
    let id = cleanText(req.method === "POST" ? req.body?.id : req.query?.id, 100);
    if (!id) {
      const { data, error } = await supabase
        .from("fsa_articles")
        .select("id")
        .not("status", "in", `(${TERMINAL.join(",")})`)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(200).json({ message: "Nothing is waiting in the gauntlet." });
      id = data.id;
    }
    currentId = id;

    const { data: article, error } = await supabase.from("fsa_articles").select("*").eq("id", id).single();
    if (error || !article) return res.status(404).json({ error: "Article not found." });
    if (TERMINAL.includes(article.status)) return res.status(200).json({ id, status: article.status, terminal: true });
    currentStage = article.status;

    let updated;
    switch (article.status) {
      // Runs between Seed and Draft. Only the reported lane actually searches
      // for secondary sourcing; essay lane passes through without a Claude
      // call, since it has no sourcing requirement to help satisfy. Either
      // way this always advances to "researched", so the Assignment Editor
      // below sees a settled researcher_notes value (populated or
      // intentionally empty) before it decides whether the reported-lane
      // sourcing gate is met.
      case "submitted": {
        if (article.format_lane === "reported") {
          const researched = await callAgent({
            name: "researcher",
            system: RESEARCHER,
            schema: AGENT_SCHEMAS.researcher,
            input: {
              category: article.category,
              seed: article.seed,
              angle: article.angle,
            },
            maxTokens: 1800,
          });
          updated = await updateAtStage(supabase, id, article.status, {
            researcher_notes: researched.citations,
            status: "researched",
            final_notes: null,
          });
        } else {
          updated = await updateAtStage(supabase, id, article.status, {
            status: "researched",
            final_notes: null,
          });
        }
        break;
      }

      case "researched": {
        const brief = await callAgent({
          name: "assignment",
          system: ASSIGNMENT_EDITOR,
          schema: AGENT_SCHEMAS.assignment,
          input: {
            category: article.category,
            secondary_category: article.secondary_category || null,
            seed: article.seed,
            angle: article.angle,
            issue: article.issue,
            format_lane: article.format_lane || null,
            source_notes: article.source_notes || "",
            researcher_notes: article.researcher_notes || [],
            previous_brief: article.brief || null,
            previous_draft: article.draft || "",
            editor_override: article.brief?.editor_override || null,
          },
          maxTokens: 2600,
        });
        if (brief.needs_clarification) {
          updated = await updateAtStage(supabase, id, article.status, {
            brief,
            status: "needs_human",
            final_notes: brief.clarification_reason || "The Assignment Editor needs a more specific source or premise.",
          });
        } else {
          updated = await updateAtStage(supabase, id, article.status, {
            brief,
            category: brief.category,
            // The Assignment Editor can reclassify the primary category
            // (unlike secondary_category, which is an owner/scout choice it
            // never sets); if that reclassification happens to land on
            // whatever the owner had picked as secondary, drop it rather
            // than leave the article with the same room in both slots.
            secondary_category: article.secondary_category && article.secondary_category !== brief.category ? article.secondary_category : null,
            status: "briefed",
            final_notes: null,
          });
        }
        break;
      }

      case "briefed": {
        const result = await callAgent({
          name: "correspondent",
          system: CORRESPONDENT,
          schema: AGENT_SCHEMAS.correspondent,
          input: {
            brief: article.brief,
            source_notes: article.source_notes || "",
            previous_draft: article.draft || "",
            revision_notes: latestRevisionNotes(article),
          },
          maxTokens: 5200,
        });
        updated = await updateAtStage(supabase, id, article.status, {
          brief: { ...article.brief, title_working: result.title, dek: result.dek },
          draft: cleanArticleDraft(result.draft),
          draft_meta: {
            open_questions: result.open_questions,
            claims_to_verify: result.claims_to_verify,
          },
          status: "drafted",
          draft_round: Number(article.draft_round || 0) + 1,
          final_notes: null,
        });
        break;
      }

      case "drafted": {
        const criticInput = {
          brief: article.brief,
          format_lane: article.format_lane || null,
          secondary_category: article.secondary_category || null,
          source_notes: article.source_notes || "",
          researcher_notes: article.researcher_notes || [],
          draft: article.draft,
          correspondent_open_questions: article.draft_meta || {},
        };
        const [factRaw, editorialRaw, categoryRaw] = await Promise.all([
          callAgent({ name: "fact_specificity", system: FACT_SPECIFICITY_DESK, schema: AGENT_SCHEMAS.critique, input: criticInput }),
          callAgent({ name: "editorial_test", system: EDITORIAL_TEST_AUDITOR, schema: AGENT_SCHEMAS.critique, input: criticInput }),
          callAgent({ name: "category_desk", system: CATEGORY_DESK[article.category], schema: AGENT_SCHEMAS.critique, input: criticInput }),
        ]);
        const fact = normalizedCritique(factRaw);
        const editorial = normalizedCritique(editorialRaw);
        const category = normalizedCritique(categoryRaw);
        let log = appendCritique(article.critique_log, "text_critique", "fact_specificity_desk", fact, article.draft_round);
        log = appendCritique(log, "text_critique", "editorial_test_auditor", editorial, article.draft_round);
        log = appendCritique(log, "text_critique", "category_desk", category, article.draft_round);

        const results = [fact, editorial, category];
        const route = critiqueRoute(results, article.draft_round);
        if (route === "text_approved") {
          updated = await updateAtStage(supabase, id, article.status, { critique_log: log, status: "text_approved", final_notes: null });
        } else if (route === "needs_human") {
          const blockers = results.flatMap((result) => result.notes).filter((note) => note.disposition === "block").slice(0, 3);
          updated = await updateAtStage(supabase, id, article.status, {
            critique_log: log,
            status: "needs_human",
            final_notes: blockers.map((note) => note.problem).join(" ") || "The text needs an owner decision on a truth, safety, or material representation issue.",
          });
        } else {
          updated = await updateAtStage(supabase, id, article.status, { critique_log: log, status: "briefed", final_notes: null });
        }
        break;
      }

      case "text_approved": {
        // Resuming after a reference pack was attached: the art brief and
        // editor recommendation were already decided and stored before the
        // gate held this article at "reference_pending", so reuse them
        // instead of re-running those two agents a second time.
        let art = article.image_brief?.art_direction;
        let recommendation = article.brief?.editor_recommendation;
        if (!art) {
          const [artResult, recommendationResult] = await Promise.all([
            callAgent({
              name: "art_direction",
              system: ART_DIRECTOR,
              schema: AGENT_SCHEMAS.art,
              input: { brief: article.brief, draft: article.draft, category: article.category },
            }),
            callAgent({
              name: "editor_recommendation",
              system: EDITOR_IN_CHIEF,
              schema: AGENT_SCHEMAS.recommendation,
              input: {
                brief: article.brief,
                draft: article.draft,
                draft_meta: article.draft_meta,
                critique_log: article.critique_log,
              },
            }),
          ]);
          art = artResult;
          recommendation = recommendationResult;
        }

        const referencePack = Array.isArray(article.reference_pack) ? article.reference_pack : [];
        if (art.needs_reference_pack && !referencePack.length) {
          updated = await updateAtStage(supabase, id, article.status, {
            brief: { ...article.brief, editor_recommendation: recommendation },
            image_brief: { ...article.image_brief, art_direction: art },
            status: "reference_pending",
            final_notes: `Attach 1-3 real reference photos of ${art.reference_subject || "this piece's specific real subject"} before the hero image can be generated.`,
          });
          break;
        }

        // Notion Image Asset Log dedup check: advisory only, never blocks
        // generation. A missing NOTION_API_KEY or any Notion outage is
        // logged and skipped -- this is bookkeeping on top of the real
        // deliverable (the image), not a gate like the Reference Pack above.
        const referencePhotoUrls = referencePack.map((asset) => asset?.url).filter(Boolean);
        const subjectForLog = art.needs_reference_pack ? art.reference_subject : art.image_prompt;
        let similarExistingAssets = [];
        try {
          similarExistingAssets = await findSimilarImageAssets(subjectForLog);
        } catch (notionError) {
          console.warn("[gauntlet] Notion dedup check skipped", notionError instanceof Error ? notionError.message : notionError);
        }

        const generated = await generateGeminiImage({
          prompt: art.image_prompt,
          referenceImageUrls: referencePhotoUrls,
        });
        const extension = generated.mimeType === "image/png" ? "png" : generated.mimeType === "image/webp" ? "webp" : "jpg";
        const imageUrl = await uploadPublicImage(
          supabase,
          `generated/${id}/${Date.now()}.${extension}`,
          Buffer.from(generated.base64, "base64"),
          generated.mimeType,
        );
        const heroAsset = {
          role: "hero",
          url: imageUrl,
          source_url: imageUrl,
          credit: "Original FSA editorial artwork, generated for this piece",
          license: "Original artwork created for FSA",
          caption: art.caption_direction || "",
          alt: art.alt_text_direction || `Original FSA editorial artwork for the ${article.category} desk.`,
        };

        // Log the generation to the Image Asset Log after the fact, same
        // advisory/non-blocking treatment as the dedup check above. The
        // Article relation is left empty unless Content Register already
        // has a page whose Link exactly matches this article's site_url --
        // expected to usually be empty for freshly-generated gauntlet
        // content, since that register isn't auto-populated by this
        // pipeline (see lib/notion.js for why).
        let notionImageLogPageId = null;
        try {
          const contentRegisterPageId = article.site_url ? await findContentRegisterPageByUrl(article.site_url) : null;
          const logged = await logGeneratedImage({
            imageId: `${article.category}-${id.slice(0, 8)}-${Date.now()}`,
            subject: subjectForLog,
            prompt: art.image_prompt,
            modelUsed: "Nano Banana Pro",
            referencePhotoUrls,
            generatedImageUrl: imageUrl,
            articlePageId: contentRegisterPageId,
          });
          notionImageLogPageId = logged.pageId;
        } catch (notionError) {
          console.warn("[gauntlet] Notion image log skipped", notionError instanceof Error ? notionError.message : notionError);
        }

        const existingAssets = Array.isArray(article.image_brief?.assets) ? article.image_brief.assets : [];
        const assets = [heroAsset, ...existingAssets.filter((asset) => asset?.role !== "hero")].slice(0, 3);
        updated = await updateAtStage(supabase, id, article.status, {
          brief: { ...article.brief, editor_recommendation: recommendation },
          image_url: heroAsset.url,
          image_brief: {
            ...art,
            assets,
            auto_image_source: "gemini_generated",
            similar_existing_assets: similarExistingAssets,
            notion_image_log_page_id: notionImageLogPageId,
          },
          status: "ready_for_review",
          final_notes: null,
        });
        break;
      }

      case "image_review": {
        const assets = article.image_brief?.assets || [];
        const hero = assets.find((asset) => asset.role === "hero") || assets[0] || {};
        const photo = normalizedCritique(await callAgent({
          name: "photo_critic",
          system: PHOTO_CRITIC,
          schema: AGENT_SCHEMAS.photo,
          imageUrl: article.image_url,
          input: {
            article_title: article.brief?.title_working,
            article_dek: article.brief?.dek,
            category: article.category,
            image_brief: article.image_brief?.image_brief,
            asset_metadata: hero,
          },
        }));
        const round = Number(article.image_round || 0) + 1;
        const log = appendCritique(article.critique_log, "image_critique", "photo_critic", photo, round);
        updated = await updateAtStage(supabase, id, article.status, {
          image_round: round,
          critique_log: log,
          image_brief: { ...article.image_brief, photo_review: photo },
          status: "ready_for_review",
          final_notes: photo.verdict === "pass" ? null : "The article is reviewable, but the selected image needs your judgment or replacement.",
        });
        break;
      }

      default:
        return res.status(409).json({ error: `Status '${article.status}' is not a runnable gauntlet stage.` });
    }

    return res.status(200).json({ id, status: updated.status, terminal: TERMINAL.includes(updated.status) });
  } catch (error) {
    console.error("[gauntlet] stage failed", {
      id: currentId,
      stage: currentStage,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: error instanceof Error ? error.message : "The gauntlet could not complete this stage." });
  }
}
