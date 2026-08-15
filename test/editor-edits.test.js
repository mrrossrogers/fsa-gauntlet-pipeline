import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the edit screen replaces Your Call with Editor Edits", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /text: "Editor Edits"/);
  assert.match(source, /button\("Chat"/);
  assert.match(source, /button\("Re-submit"/);
  assert.match(source, /button\("Hold"/);
  assert.match(source, /button\("Kill"/);
  assert.doesNotMatch(source, /text: "Your call"/i);
});

test("the editor endpoint supports conversation and revision modes", async () => {
  const source = await readFile(new URL("../api/update-article.js", import.meta.url), "utf8");
  assert.match(source, /body\.mode === "resubmit"/);
  assert.match(source, /body\.mode === "chat"/);
  assert.match(source, /status: "drafted"/);
  assert.match(source, /Never invent reporting/);
  assert.match(source, /action === "editor_edits"/);
});
