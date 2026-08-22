import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("EDITOR_IN_CHIEF writes a short reader-facing verdict, kept explicitly separate from the owner-only reasoning", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /reader_verdict: one to two sentences/);
  assert.match(source, /Never mention desks, critiques, sourcing gaps, blocking issues, image\r?\nrights, or anything about how the piece was produced or reviewed/);
  assert.match(source, /required: \["decision", "fsa_verdict", "reader_verdict", "reasoning",/);
  assert.match(source, /reader_verdict: \{ type: "string" \}/);
});

test("the Article Preview's FSA Verdict section shows reader_verdict only -- never the internal reasoning field", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /brief\.editor_recommendation\?\.reader_verdict \|\| "Your final judgment belongs here\."/);
  assert.doesNotMatch(source, /preview-verdict[\s\S]{0,400}editor_recommendation\?\.reasoning/);
});
