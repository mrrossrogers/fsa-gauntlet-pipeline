import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validFormatLane } from "../lib/db.js";

test("validFormatLane accepts only essay and reported", () => {
  assert.equal(validFormatLane("essay"), true);
  assert.equal(validFormatLane("reported"), true);
  assert.equal(validFormatLane("reported_feature"), false);
  assert.equal(validFormatLane(""), false);
  assert.equal(validFormatLane(undefined), false);
});

test("submit-idea requires a valid format lane before creating an article", async () => {
  const source = await readFile(new URL("../api/submit-idea.js", import.meta.url), "utf8");
  assert.match(source, /validFormatLane\(formatLane\)/);
  assert.match(source, /format_lane: formatLane/);
});

test("candidate approval requires a format lane and does not silently default one", async () => {
  const source = await readFile(new URL("../api/update-candidate.js", import.meta.url), "utf8");
  assert.match(source, /validFormatLane\(formatLane\)/);
  assert.match(source, /format_lane: formatLane/);
});

test("the Assignment Editor prompt gates Draft on real sourcing for the reported lane only", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /format_lane is reported/);
  assert.match(source, /real, named\r?\ninterview subject or expert/);
  assert.match(source, /can never stand in for a\r?\nfabricated firsthand anecdote/);
  assert.match(source, /format_lane is\r?\nessay, do not apply this sourcing requirement/);
});

test("the Fact & Specificity Desk still checks essay-lane generalizations without weakening existing checks", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /unsupported generalization about "couples,"/);
  assert.match(source, /applies to every draft, including essay-lane/);
  // The five original disposition checks stay intact, word for word.
  assert.match(source, /1\. unsupported factual specificity;/);
  assert.match(source, /5\. claims that need a primary, official, clinical, or firsthand source;/);
  assert.match(source, /Use block only for fabricated firsthand\r?\nexperience, fake quotations or sources/);
});

test("process-article passes format_lane and researcher_notes into the gated stages", async () => {
  const source = await readFile(new URL("../api/process-article.js", import.meta.url), "utf8");
  assert.match(source, /format_lane: article\.format_lane \|\| null,/);
  assert.match(source, /researcher_notes: article\.researcher_notes \|\| \[\],/);
});
