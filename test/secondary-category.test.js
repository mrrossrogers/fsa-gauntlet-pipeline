import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validSecondaryCategory } from "../lib/db.js";

test("validSecondaryCategory allows empty, rejects a match with primary, requires a real category otherwise", () => {
  assert.equal(validSecondaryCategory("food", null), true);
  assert.equal(validSecondaryCategory("food", ""), true);
  assert.equal(validSecondaryCategory("food", "alcohol"), true);
  assert.equal(validSecondaryCategory("food", "food"), false);
  assert.equal(validSecondaryCategory("food", "wine"), false);
});

test("the Scout is told to use Food+X overlap to solve the food-sourcing problem, and its schema allows secondary_category", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /Food ideas are harder to source than Sex or Alcohol in this\r?\nsystem/);
  assert.match(source, /look first for an honest\r?\nFood\+Alcohol or Food\+Sex overlap/);
  assert.match(source, /required: \["category", "secondary_category", "seed",/);
  assert.match(source, /secondary_category: \{ type: \["string", "null"\], enum: \["food", "sex", "alcohol", null\] \}/);
});

test("every category desk is told not to treat a declared secondary_category as off-desk drift", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  const normalized = source.replace(/\s+/g, " ");
  const mentions = normalized.match(/do not flag material belonging to that secondary room as/g) || [];
  assert.equal(mentions.length, 3, "expected all three category desks (food, sex, alcohol) to carry the secondary_category allowance");
});

test("secondary_category is threaded from candidates into approved articles, and validated wherever it's set", async () => {
  const addCandidate = await readFile(new URL("../api/add-candidate.js", import.meta.url), "utf8");
  assert.match(addCandidate, /validSecondaryCategory\(category, secondaryCategory\)/);
  assert.match(addCandidate, /secondary_category: secondaryCategory/);

  const updateCandidate = await readFile(new URL("../api/update-candidate.js", import.meta.url), "utf8");
  assert.match(updateCandidate, /secondary_category: candidate\.secondary_category,/);
  assert.match(updateCandidate, /validSecondaryCategory\(category, secondaryCategory\)/);

  const submitIdea = await readFile(new URL("../api/submit-idea.js", import.meta.url), "utf8");
  assert.match(submitIdea, /validSecondaryCategory\(category, secondaryCategory\)/);
  assert.match(submitIdea, /secondary_category: secondaryCategory,/);

  const scoutCandidates = await readFile(new URL("../api/scout-candidates.js", import.meta.url), "utf8");
  assert.match(scoutCandidates, /candidate\.secondary_category && candidate\.secondary_category !== candidate\.category \? candidate\.secondary_category : null/);
});

test("process-article.js gives the Assignment Editor and category critics read access to secondary_category, and clears it if the primary category is reclassified onto it", async () => {
  const source = await readFile(new URL("../api/process-article.js", import.meta.url), "utf8");
  assert.match(source, /secondary_category: article\.secondary_category \|\| null,/);
  assert.match(source, /secondary_category: article\.secondary_category && article\.secondary_category !== brief\.category \? article\.secondary_category : null,/);
});

test("both intake forms and the candidate edit form offer a secondary room, mutually exclusive with the primary", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="article-secondary-category"/);
  assert.match(html, /id="candidate-secondary-category"/);

  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /function excludeFromSecondaryEls\(primary, secondary\)/);
  assert.match(js, /excludeFromSecondary\("#article-category", "#article-secondary-category"\)/);
  assert.match(js, /excludeFromSecondary\("#candidate-category", "#candidate-secondary-category"\)/);
  assert.match(js, /excludeFromSecondaryEls\(category, secondaryCategory\)/);
  assert.match(js, /secondaryCategory: \$\("#article-secondary-category"\)\.value/);
  assert.match(js, /secondaryCategory: \$\("#candidate-secondary-category"\)\.value/);
});
