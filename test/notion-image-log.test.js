import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { externalFiles, normalizeForMatch, tokenOverlap } from "../lib/notion.js";

test("normalizeForMatch reduces punctuation and case so similar phrases line up", () => {
  assert.equal(normalizeForMatch('Rittenhouse Rye 100, three-quarter angle'), "rittenhouse rye 100 three quarter angle");
  assert.equal(normalizeForMatch(""), "");
  assert.equal(normalizeForMatch(null), "");
});

test("tokenOverlap scores real subject matches high and unrelated subjects low", () => {
  const high = tokenOverlap("Rittenhouse Rye 100 bottle, three-quarter angle", "Rittenhouse Rye 100 bottle on a bar top");
  const low = tokenOverlap("Rittenhouse Rye 100 bottle", "A quiet kitchen counter with morning light");
  assert.ok(high > 0.5, `expected a strong match, got ${high}`);
  assert.ok(low < 0.3, `expected a weak match, got ${low}`);
  assert.equal(tokenOverlap("", "anything"), 0);
  assert.equal(tokenOverlap("anything", ""), 0);
});

test("externalFiles builds Notion's external-file shape and caps at 10", () => {
  const files = externalFiles(["https://a.test/1.png", "https://a.test/2.png", null, ""], "reference");
  assert.equal(files.length, 2);
  assert.deepEqual(files[0], { name: "reference-1", type: "external", external: { url: "https://a.test/1.png" } });
  const capped = externalFiles(Array.from({ length: 15 }, (_, i) => `https://a.test/${i}.png`), "generated");
  assert.equal(capped.length, 10);
});

test("Notion sync is advisory-only: never blocks or replaces the Reference Pack gate or Gemini generation", async () => {
  const source = await readFile(new URL("../api/process-article.js", import.meta.url), "utf8");
  assert.match(source, /findSimilarImageAssets\(subjectForLog\)/);
  assert.match(source, /catch \(notionError\) \{\r?\n\s*console\.warn\("\[gauntlet\] Notion dedup check skipped"/);
  assert.match(source, /logGeneratedImage\(\{/);
  assert.match(source, /catch \(notionError\) \{\r?\n\s*console\.warn\("\[gauntlet\] Notion image log skipped"/);
  // The dedup/log calls must sit after the Reference Pack gate's early
  // "break", so a missing reference pack still holds the article at
  // reference_pending regardless of Notion's availability.
  assert.match(source, /status: "reference_pending",[\s\S]*break;\s*\}[\s\S]*findSimilarImageAssets/);
});

test("logGeneratedImage always defaults Status to Draft and only sets Article when a page id is supplied", async () => {
  const source = await readFile(new URL("../lib/notion.js", import.meta.url), "utf8");
  assert.match(source, /Status: \{ select: \{ name: "Draft" \} \}/);
  assert.match(source, /if \(articlePageId\) properties\.Article = \{ relation: \[\{ id: articlePageId \}\] \}/);
  assert.match(source, /IMAGE_ASSET_LOG_DATABASE_ID = "20d16122-c23f-411b-9642-58b9ea8402f7"/);
  assert.match(source, /CONTENT_REGISTER_DATABASE_ID = "f25cc7d4-9c57-4683-91ed-025e712fb631"/);
  assert.match(source, /NOTION_API_KEY is not configured/);
});
