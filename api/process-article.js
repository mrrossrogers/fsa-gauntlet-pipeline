import { requestHasCronSecret, requestIsOwner } from "../lib/auth.js";
import { callAgent } from "../lib/claude.js";
import { chooseArticleImage } from "../lib/auto-image.js";
import { cleanText, getSupabase } from "../lib/db.js";
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
        const [art, recommendation] = await Promise.all([
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
        const image = chooseArticleImage({ article });
        const existingAssets = Array.isArray(article.image_brief?.assets) ? article.image_brief.assets : [];
        const assets = [image.asset, ...existingAssets.filter((asset) => asset?.role !== "hero")].slice(0, 3);
        updated = await updateAtStage(supabase, id, article.status, {
          brief: { ...article.brief, editor_recommendation: recommendation },
          image_url: image.asset.url,
          image_brief: { ...art, assets, auto_image_source: image.source },
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
