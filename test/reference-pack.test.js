import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseDataUrl } from "../lib/gemini-image.js";

test("parseDataUrl only accepts real image data URLs", () => {
  const parsed = parseDataUrl("data:image/png;base64,QUJD");
  assert.deepEqual(parsed, { mimeType: "image/png", data: "QUJD" });
  assert.equal(parseDataUrl("data:image/jpg;base64,QUJD").mimeType, "image/jpeg");
  assert.equal(parseDataUrl("not-a-data-url"), null);
  assert.equal(parseDataUrl("data:text/plain;base64,QUJD"), null);
  assert.equal(parseDataUrl(""), null);
});

test("the Art Director decides the reference pack gate, not a separate check", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /needs_reference_pack/);
  assert.match(source, /reference_subject/);
  assert.match(source, /image_prompt/);
  assert.match(source, /required: \[\r?\n\s*"image_brief",[\s\S]*"needs_reference_pack",\r?\n\s*"reference_subject",\r?\n\s*"image_prompt",/);
});

test("text_approved holds at reference_pending only when the gate is unmet, and reuses a stored art brief on resume", async () => {
  const source = await readFile(new URL("../api/process-article.js", import.meta.url), "utf8");
  assert.match(source, /case "text_approved": \{/);
  assert.match(source, /article\.image_brief\?\.art_direction/);
  assert.match(source, /art\.needs_reference_pack && !referencePack\.length/);
  assert.match(source, /status: "reference_pending"/);
  assert.match(source, /generateGeminiImage\(\{/);
  assert.match(source, /uploadPublicImage\(/);
  // The old stock/fallback image chooser is gone from this stage; auto-image.js
  // itself must not be touched, since lib/article-package.js and
  // test/auto-image.test.js still depend on its exports.
  assert.doesNotMatch(source, /chooseArticleImage/);
  assert.doesNotMatch(source, /auto-image\.js/);
});

test("upload-reference-pack.js gates every action behind the owner and the reference_pending status", async () => {
  const source = await readFile(new URL("../api/upload-reference-pack.js", import.meta.url), "utf8");
  assert.match(source, /requireOwner\(req, res\)/);
  assert.match(source, /article\.status !== "reference_pending"/);
  assert.match(source, /MAX_PACK_SIZE = 3/);
  assert.match(source, /action === "add"/);
  assert.match(source, /action === "remove"/);
  // action === "resume" falls through to the final branch rather than an
  // explicit if, but it must require at least one attached image and land
  // back on text_approved so the gauntlet can pick the article up again.
  assert.match(source, /if \(!referencePack\.length\) return res\.status\(400\)/);
  assert.match(source, /status: "text_approved"/);
});

test("the dashboard shows the reference pack gate but never auto-runs it", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /reference_pending: "needs reference photos"/);
  assert.doesNotMatch(source, /RUNNABLE = new Set\(\[[^\]]*"reference_pending"/);
  assert.match(source, /function referencePackEditor\(article\)/);
  assert.match(source, /\/api\/upload-reference-pack/);
});
