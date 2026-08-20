import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the submitted stage always advances to researched, searching only for the reported lane", async () => {
  const source = await readFile(new URL("../api/process-article.js", import.meta.url), "utf8");
  assert.match(source, /case "submitted": \{/);
  assert.match(source, /article\.format_lane === "reported"/);
  assert.match(source, /name: "researcher"/);
  assert.match(source, /status: "researched"/);
  assert.match(source, /case "researched": \{/);
  // The Assignment Editor call that used to run directly at "submitted"
  // still runs, just one stage later, unchanged in shape.
  assert.match(source, /name: "assignment"/);
});

test("RESEARCHER never substitutes for a real interview", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /export const RESEARCHER = `/);
  assert.match(source, /Never invent a primary anecdote, a\r?\nfirsthand scene, or a quote attributed to a specific real person/);
  assert.match(source, /A thin, honest, empty list is a correct result, not a\r?\nfailure/);
});

test("the researcher schema only allows a citation list, no free text escape hatch", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /researcher: \{/);
  assert.match(source, /required: \["citations"\]/);
  assert.match(source, /required: \["source", "supports"\]/);
});

test("the dashboard knows about the researched stage", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /RUNNABLE = new Set\(\["submitted", "researched",/);
  assert.match(source, /STAGES = \["submitted", "researched",/);
  assert.match(source, /researched: "assignment"/);
});
