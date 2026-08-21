// Image Asset Log (under FSA Founder's Office) and Content Register
// database IDs, resolved once via Notion search on 2026-08-20. Both are
// single-source databases, so the stable, well-documented 2022-06-28 REST
// contract (query/create against a database_id) is used rather than the
// newer multi-data-source API surface -- lower risk for something that
// can't be exercised against a live call from this codebase.
const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
const IMAGE_ASSET_LOG_DATABASE_ID = "20d16122-c23f-411b-9642-58b9ea8402f7";
const CONTENT_REGISTER_DATABASE_ID = "f25cc7d4-9c57-4683-91ed-025e712fb631";

function env(name) {
  return String(process.env[name] || "").trim();
}

function authHeaders() {
  const token = env("NOTION_API_KEY");
  if (!token) throw new Error("NOTION_API_KEY is not configured.");
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionRequest(path, body) {
  const response = await fetch(`${NOTION_API}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Notion request failed (${response.status}).`);
  return payload;
}

function plainText(richTextArray) {
  return (Array.isArray(richTextArray) ? richTextArray : []).map((part) => part?.plain_text || "").join("");
}

// Exported alongside the network-calling functions below purely so the
// matching/serialization logic -- the only parts of this file that are pure
// and don't require a live Notion call -- can be unit tested directly.
export function normalizeForMatch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function tokenOverlap(a, b) {
  const tokensA = new Set(normalizeForMatch(a).split(" ").filter((token) => token.length > 2));
  const tokensB = new Set(normalizeForMatch(b).split(" ").filter((token) => token.length > 2));
  if (!tokensA.size || !tokensB.size) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / Math.min(tokensA.size, tokensB.size);
}

/**
 * Advisory dedup check: looks for existing Image Asset Log rows whose
 * Subject plausibly matches the one about to be generated, so the owner can
 * see whether similar imagery already exists across articles. Notion has no
 * fuzzy-match filter, so this fetches a recent page of rows and matches
 * client-side by token overlap. Never blocks generation -- callers treat
 * this as informational only.
 */
export async function findSimilarImageAssets(subject, { limit = 3, threshold = 0.5 } = {}) {
  if (!subject || !subject.trim()) return [];
  const payload = await notionRequest(`/databases/${IMAGE_ASSET_LOG_DATABASE_ID}/query`, {
    page_size: 100,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
  });
  const candidates = (payload.results || [])
    .map((page) => ({
      pageId: page.id,
      imageId: plainText(page.properties?.["Image ID"]?.title),
      subject: plainText(page.properties?.Subject?.rich_text),
      status: page.properties?.Status?.select?.name || "",
    }))
    .filter((candidate) => candidate.subject)
    .map((candidate) => ({ ...candidate, score: tokenOverlap(subject, candidate.subject) }))
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return candidates;
}

/**
 * Best-effort lookup of a Content Register page for the Image Asset Log's
 * Article relation, matched by exact Link URL. Gauntlet-produced articles
 * are not pre-registered in Content Register (it's a hand-maintained
 * editorial tracker, currently covering only the site's original
 * hand-authored pieces), so this will usually find nothing until an entry
 * is added there manually -- that's expected, not a bug, and the caller
 * treats a null result as "leave the relation empty."
 */
export async function findContentRegisterPageByUrl(url) {
  if (!url) return null;
  const payload = await notionRequest(`/databases/${CONTENT_REGISTER_DATABASE_ID}/query`, {
    filter: { property: "Link", url: { equals: url } },
    page_size: 1,
  });
  return payload.results?.[0]?.id || null;
}

export function externalFiles(urls, namePrefix) {
  return (urls || []).filter(Boolean).slice(0, 10).map((url, index) => ({
    name: `${namePrefix}-${index + 1}`,
    type: "external",
    external: { url },
  }));
}

/**
 * Creates one row in the Image Asset Log for a just-generated image.
 * Status always starts "Draft" per spec. articlePageId is optional --
 * pass null to leave the Article relation empty (see
 * findContentRegisterPageByUrl above for why that's the common case).
 */
export async function logGeneratedImage({ imageId, subject, prompt, modelUsed, referencePhotoUrls, generatedImageUrl, articlePageId, dateGenerated }) {
  const properties = {
    "Image ID": { title: [{ text: { content: String(imageId).slice(0, 200) } }] },
    Subject: { rich_text: [{ text: { content: String(subject || "").slice(0, 2000) } }] },
    Prompt: { rich_text: [{ text: { content: String(prompt || "").slice(0, 2000) } }] },
    "Model Used": { select: { name: modelUsed || "Nano Banana Pro" } },
    Status: { select: { name: "Draft" } },
    "Date Generated": { date: { start: dateGenerated || new Date().toISOString() } },
    "Reference Photo": { files: externalFiles(referencePhotoUrls, "reference") },
    "Generated Image": { files: externalFiles([generatedImageUrl], "generated") },
  };
  if (articlePageId) properties.Article = { relation: [{ id: articlePageId }] };

  const page = await notionRequest("/pages", {
    parent: { database_id: IMAGE_ASSET_LOG_DATABASE_ID },
    properties,
  });
  return { pageId: page.id };
}
