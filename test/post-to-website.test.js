import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { existingSlugsForCategory, insertGauntletStory, nextIdentifier, serializeStoryEntry } from "../lib/github.js";

const SAMPLE_STORY = {
  identifier: "16",
  headline: 'The Night You Say "Yes"',
  slug: "the-night-you-say-yes",
  primaryCategory: "FOOD",
  description: "A test description.",
  author: "Ross Rogers",
  publicationDate: "2026-08-20",
  heroImage: "https://vsijljezyvhmfmbefhlw.supabase.co/storage/v1/object/public/fsa-images/generated/x.png",
  heroImageDescription: "A warmly lit table.",
  moment: "For saying yes more often",
  tone: "gold",
  emotion: "Belonging",
  outcome: "Leave more connected than you arrived",
  articleIntroduction: "An intro with a \"quoted\" phrase and a line\nbreak.",
  articleSections: [
    { heading: "First heading", paragraphs: ["Paragraph one.", "Paragraph two."] },
    { heading: "Second heading", paragraphs: ["Another paragraph."] },
  ],
  articleQuote: "A quote with a backslash \\ in it.",
  planningNotes: ["Note one.", "Note two."],
  editorialConclusion: "YES. Say yes.",
  relatedStorySlugs: ["a-table-set-for-coming-home"],
  featured: false,
};

// A minimal but structurally faithful fragment of food-sex-alcohol1's
// src/data/stories.ts: a hand-authored seed with identifier/slug/
// primaryCategory, followed by the empty gauntletStories append point.
const SAMPLE_SOURCE = `export type Story = { identifier: string };

const seeds = [
  { identifier: "01", primaryCategory: "FOOD", slug: "a-table-set-for-coming-home" },
  { identifier: "05", primaryCategory: "SEX", slug: "luxury-sheets-worth-every-dollar" },
];

export const gauntletStories: Story[] = [
];

export const stories: Story[] = [...seeds, ...gauntletStories];
`;

test("nextIdentifier picks one past the highest existing identifier", () => {
  assert.equal(nextIdentifier(SAMPLE_SOURCE), "06");
  assert.equal(nextIdentifier("no identifiers here"), "01");
});

test("existingSlugsForCategory only returns slugs for the requested category", () => {
  const foodSlugs = existingSlugsForCategory(SAMPLE_SOURCE, "FOOD");
  assert.ok(foodSlugs.includes("a-table-set-for-coming-home"));
  assert.ok(!foodSlugs.includes("luxury-sheets-worth-every-dollar"));
});

test("serializeStoryEntry escapes quotes, newlines, and backslashes so nothing breaks out of its string", () => {
  const entry = serializeStoryEntry(SAMPLE_STORY);
  // JSON.stringify's escaping means a raw, unescaped newline or an
  // unescaped quote should never appear inside the emitted string literals.
  assert.match(entry, /articleIntroduction: "An intro with a \\"quoted\\" phrase and a line\\nbreak\."/);
  assert.match(entry, /articleQuote: "A quote with a backslash \\\\ in it\."/);
  assert.match(entry, /identifier: "16"/);
  assert.match(entry, /publicationStatus: "published"/);
});

test("insertGauntletStory appends into the empty array without touching the seeds above it", () => {
  const updated = insertGauntletStory(SAMPLE_SOURCE, SAMPLE_STORY);
  assert.match(updated, /identifier: "01", primaryCategory: "FOOD", slug: "a-table-set-for-coming-home"/);
  assert.match(updated, /export const gauntletStories: Story\[\] = \[\n {2}\{\r?\n {4}identifier: "16"/);
  assert.match(updated, /export const stories: Story\[\] = \[\.\.\.seeds, \.\.\.gauntletStories\];/);
});

test("insertGauntletStory appends a second entry after an existing one, not overwriting it", () => {
  const once = insertGauntletStory(SAMPLE_SOURCE, SAMPLE_STORY);
  const twice = insertGauntletStory(once, { ...SAMPLE_STORY, identifier: "17", slug: "a-second-story" });
  assert.match(twice, /identifier: "16"/);
  assert.match(twice, /identifier: "17"/);
  assert.match(twice, /identifier: "16"[\s\S]*identifier: "17"/);
});

test("post_to_website is gated on ready_for_review, an image, and not already posted, and never invents a related slug", async () => {
  const source = await readFile(new URL("../api/update-article.js", import.meta.url), "utf8");
  assert.match(source, /current\.status !== "ready_for_review"/);
  assert.match(source, /if \(!current\.image_url\)/);
  assert.match(source, /if \(current\.site_url\)/);
  assert.match(source, /candidateSlugs\.includes\(candidate\)/);
  assert.match(source, /name: "publisher"/);
  assert.match(source, /status: "published"/);
});

test("the Publisher prompt reshapes without inventing content, and only picks slugs it was given", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /export const PUBLISHER = `/);
  assert.match(source, /Do not add a claim, anecdote, quote, source, or\r?\nargument that is not already in the draft/);
  assert.match(source, /Never\r?\ninvent a slug that was not supplied to you\./);
  assert.match(source, /publisher: \{/);
  assert.match(source, /"headline",\r?\n {6}"description",/);
});

test("the dashboard offers Review Final Article and Post to Website only when ready, and shows the live link once posted", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /function publishActions\(article\)/);
  assert.match(source, /"Review Final Article"/);
  assert.match(source, /"Post to Website"/);
  assert.match(source, /action: "post_to_website"/);
  assert.match(source, /article\.status !== "ready_for_review"/);
});
