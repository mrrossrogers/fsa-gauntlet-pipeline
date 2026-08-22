import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Art Director writes the actual finished hero caption and alt text, not meta-direction about how to write them", async () => {
  const source = await readFile(new URL("../lib/prompts.js", import.meta.url), "utf8");
  assert.match(source, /Write hero_caption and hero_alt_text as the actual, finished, reader-facing/);
  assert.match(source, /not direction or\r?\nguidance about how someone else should write them/);
  assert.match(source, /Neither field should ever mention that the image was generated, a model, a\r?\nprompt, or anything about how the piece or its art was produced/);
  assert.match(source, /required: \[\r?\n\s*"image_brief",[\s\S]*"hero_alt_text",\r?\n\s*"hero_caption",/);
  assert.doesNotMatch(source, /caption_direction|alt_text_direction/);
});

test("the generated hero image uses the Art Director's real caption/alt fields, and carries no AI-generated credit line", async () => {
  const source = await readFile(new URL("../api/process-article.js", import.meta.url), "utf8");
  assert.match(source, /caption: art\.hero_caption \|\| "",/);
  assert.match(source, /alt: art\.hero_alt_text \|\| `Original FSA editorial artwork/);
  assert.match(source, /source_url: "",\r?\n\s*credit: "",\r?\n\s*license: "",/);
  assert.doesNotMatch(source, /credit: "Original FSA editorial artwork, generated for this piece"/);
});
