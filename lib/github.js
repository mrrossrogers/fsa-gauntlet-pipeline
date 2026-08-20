const SITE_REPO = "mrrossrogers/food-sex-alcohol1";
const STORIES_PATH = "src/data/stories.ts";
const GAUNTLET_ARRAY_START = "export const gauntletStories: Story[] = [";

function env(name) {
  return String(process.env[name] || "").trim();
}

function authHeaders() {
  const token = env("FSA_SITE_GITHUB_TOKEN");
  if (!token) throw new Error("FSA_SITE_GITHUB_TOKEN is not configured.");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getStoriesFile() {
  const response = await fetch(`https://api.github.com/repos/${SITE_REPO}/contents/${STORIES_PATH}`, {
    headers: authHeaders(),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Could not read stories.ts (${response.status}).`);
  return { content: Buffer.from(payload.content, "base64").toString("utf8"), sha: payload.sha };
}

async function putStoriesFile(content, sha, message) {
  const response = await fetch(`https://api.github.com/repos/${SITE_REPO}/contents/${STORIES_PATH}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha,
      branch: "main",
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // A stale sha (someone else committed to stories.ts in between) lands
    // here as a plain conflict error -- that's the correct outcome, not a
    // bug: it stops a concurrent write from silently clobbering another.
    throw new Error(payload?.message || `Could not commit stories.ts (${response.status}).`);
  }
  return { commitSha: payload.commit?.sha };
}

function jsonLiteral(value) {
  return JSON.stringify(value);
}

// Every string field is serialized through JSON.stringify (jsonLiteral),
// which escapes quotes, backslashes, and newlines into safe inline escape
// sequences -- so nothing an agent writes into a title, quote, or paragraph
// can produce a stray literal newline or unescaped quote that would corrupt
// the surrounding TypeScript source or let content break out of its string.
// Exported (alongside the network-calling functions below) purely so the
// TypeScript-source mutation logic -- the riskiest part of this file -- can
// be unit tested directly, without mocking the GitHub API.
export function serializeStoryEntry(story) {
  const sections = story.articleSections
    .map((section) => `      { heading: ${jsonLiteral(section.heading)}, paragraphs: [${section.paragraphs.map(jsonLiteral).join(", ")}] }`)
    .join(",\n");
  return `  {
    identifier: ${jsonLiteral(story.identifier)},
    headline: ${jsonLiteral(story.headline)},
    slug: ${jsonLiteral(story.slug)},
    primaryCategory: ${jsonLiteral(story.primaryCategory)},
    description: ${jsonLiteral(story.description)},
    author: ${jsonLiteral(story.author)},
    publicationDate: ${jsonLiteral(story.publicationDate)},
    heroImage: ${jsonLiteral(story.heroImage)},
    heroImageDescription: ${jsonLiteral(story.heroImageDescription)},
    moment: ${jsonLiteral(story.moment)},
    tone: ${jsonLiteral(story.tone)},
    emotion: ${jsonLiteral(story.emotion)},
    outcome: ${jsonLiteral(story.outcome)},
    articleIntroduction: ${jsonLiteral(story.articleIntroduction)},
    articleSections: [
${sections}
    ],
    articleQuote: ${jsonLiteral(story.articleQuote)},
    planningNotes: [${story.planningNotes.map(jsonLiteral).join(", ")}],
    editorialConclusion: ${jsonLiteral(story.editorialConclusion)},
    relatedStorySlugs: [${story.relatedStorySlugs.map(jsonLiteral).join(", ")}],
    featured: ${story.featured ? "true" : "false"},
    publicationStatus: "published",
  }`;
}

export function insertGauntletStory(source, story) {
  const startIndex = source.indexOf(GAUNTLET_ARRAY_START);
  if (startIndex === -1) {
    throw new Error("stories.ts does not have the expected gauntletStories append point. Has the site's schema changed?");
  }
  const searchFrom = startIndex + GAUNTLET_ARRAY_START.length;
  const closeIndex = source.indexOf("\n];", searchFrom);
  if (closeIndex === -1) {
    throw new Error("Could not find the end of the gauntletStories array in stories.ts.");
  }
  const before = source.slice(0, closeIndex);
  const after = source.slice(closeIndex);
  const isEmptyArray = source.slice(searchFrom, closeIndex).trim() === "";
  const entry = serializeStoryEntry(story);
  return `${before}${isEmptyArray ? "" : ","}\n${entry}${after}`;
}

export function existingSlugsForCategory(source, primaryCategory) {
  const pattern = new RegExp(`primaryCategory:\\s*"${primaryCategory}"[\\s\\S]{0,60}?slug:\\s*"([a-z0-9-]+)"|slug:\\s*"([a-z0-9-]+)"[\\s\\S]{0,400}?primaryCategory:\\s*"${primaryCategory}"`, "g");
  const slugs = [...source.matchAll(pattern)].map((match) => match[1] || match[2]).filter(Boolean);
  return [...new Set(slugs)].slice(0, 30);
}

export function nextIdentifier(source) {
  const numbers = [...source.matchAll(/identifier:\s*"(\d+)"/g)].map((match) => Number(match[1])).filter((n) => Number.isFinite(n));
  const highest = numbers.length ? Math.max(...numbers) : 0;
  return String(highest + 1).padStart(2, "0");
}

/**
 * Reads the live site's stories.ts once and returns everything a caller
 * needs to both brief the Publisher agent (existing slugs, next identifier)
 * and later commit against the exact version just read (content + sha),
 * so the whole publish uses a single consistent read of the file.
 */
export async function getSiteContext() {
  const { content, sha } = await getStoriesFile();
  return {
    sha,
    content,
    identifier: nextIdentifier(content),
    slugsForCategory: (primaryCategory) => existingSlugsForCategory(content, primaryCategory),
  };
}

/**
 * Appends one story to food-sex-alcohol1's gauntletStories array and commits
 * directly to its main branch (Vercel auto-deploys from there). Only ever
 * appends -- never rewrites or removes an existing entry. Pass the
 * siteContext from getSiteContext() to commit against the exact file
 * version already read; a stale sha at commit time throws rather than
 * silently overwriting a concurrent change.
 */
export async function publishStoryToSite(story, siteContext) {
  const { content, sha } = siteContext || await getStoriesFile();
  const updated = insertGauntletStory(content, story);
  return putStoriesFile(updated, sha, `Publish "${story.headline}" from the FSA gauntlet`);
}
