import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAgentRequest } from "../lib/claude.js";

test("buildAgentRequest accepts multiple images, mixing url and pasted base64 sources, capped at 4", () => {
  const request = buildAgentRequest({
    name: "editor_edits",
    system: "sys",
    schema: { type: "object" },
    input: "hi",
    images: [
      { url: "https://example.test/a.png" },
      { dataUrl: "data:image/png;base64,QUJD" },
      { url: "https://example.test/b.png" },
      { url: "https://example.test/c.png" },
      { url: "https://example.test/d.png" }, // 5th, should be dropped by the cap
    ],
  });
  const content = request.messages[0].content;
  const images = content.filter((part) => part.type === "image");
  assert.equal(images.length, 4);
  assert.deepEqual(images[0].source, { type: "url", url: "https://example.test/a.png" });
  assert.deepEqual(images[1].source, { type: "base64", media_type: "image/png", data: "QUJD" });
  assert.equal(content.at(-1).type, "text");
});

test("buildAgentRequest still supports the legacy single imageUrl param unchanged (Photo Critic's call site)", () => {
  const request = buildAgentRequest({ name: "photo_critic", system: "sys", schema: { type: "object" }, input: "hi", imageUrl: "https://example.test/hero.png" });
  const images = request.messages[0].content.filter((part) => part.type === "image");
  assert.equal(images.length, 1);
  assert.deepEqual(images[0].source, { type: "url", url: "https://example.test/hero.png" });
});

test("the approval checklist keys match exactly between the client and the server", async () => {
  const server = await readFile(new URL("../api/update-article.js", import.meta.url), "utf8");
  const client = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const serverKeysBlock = server.slice(server.indexOf("const APPROVAL_KEYS = ["), server.indexOf("];", server.indexOf("const APPROVAL_KEYS = [")));
  const clientKeysBlock = client.slice(client.indexOf("const APPROVAL_ITEMS = ["), client.indexOf("];", client.indexOf("const APPROVAL_ITEMS = [")));
  // Labels contain capitals/spaces (e.g. "Hero picture"), so this
  // lowercase-with-underscore pattern only ever matches the keys themselves
  // on both sides -- no need to filter out alternating label matches.
  const extractKeys = (block) => [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const fromServer = extractKeys(serverKeysBlock);
  const fromClient = extractKeys(clientKeysBlock);
  assert.deepEqual(fromClient, fromServer);
  assert.equal(fromServer.length, 9);
});

test("post_to_website is gated on every checklist item being approved", async () => {
  const source = await readFile(new URL("../api/update-article.js", import.meta.url), "utf8");
  assert.match(source, /const approvals = current\.approvals \|\| \{\};\r?\n\s*if \(!APPROVAL_KEYS\.every\(\(key\) => approvals\[key\]\)\)/);
  assert.match(source, /Approve every checklist item before posting/);
});

test("save_preview only clears the approvals whose underlying field actually changed; every gauntlet re-entry resets all of them", async () => {
  const source = await readFile(new URL("../api/update-article.js", import.meta.url), "utf8");
  assert.match(source, /function recomputeApprovals\(current, changes\)/);
  assert.match(source, /changes\.approvals = recomputeApprovals\(current, changes\);/);
  assert.match(source, /function resetApprovals\(\)/);
  const resetSites = source.match(/approvals: resetApprovals\(\)/g) || [];
  const resetAssignSites = source.match(/changes\.approvals = resetApprovals\(\);/g) || [];
  // recheck, creative_draft, accept_text, retry, resubmit, and a revising
  // editor_edits should all reset every approval.
  assert.ok(resetSites.length + resetAssignSites.length >= 5, `expected at least 5 full-reset call sites, found ${resetSites.length + resetAssignSites.length}`);
});

test("toggle_approval is a lightweight, isolated update that only ever touches the one key it's given", async () => {
  const source = await readFile(new URL("../api/update-article.js", import.meta.url), "utf8");
  assert.match(source, /if \(action === "toggle_approval"\) \{/);
  assert.match(source, /if \(!APPROVAL_KEYS\.includes\(key\)\)/);
  assert.match(source, /const approvals = \{ \.\.\.\(current\.approvals \|\| \{\}\), \[key\]: Boolean\(body\.approved\) \};/);
});

test("Editor Edits can see an attached image and is told never to describe one that wasn't sent", async () => {
  const source = await readFile(new URL("../api/update-article.js", import.meta.url), "utf8");
  assert.match(source, /Never comment on a photo's composition, content,\r?\nor quality unless an image was actually attached/);
  assert.match(source, /images,\r?\n\s*input: \{/);
});

test("the dashboard scrolls the editor thread to the newest message after it's actually attached to the live DOM, not while still detached", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /detail\.replaceChildren\(detailHeader\(article\), tabs, pane\);\r?\n\s*\/\/ Whole tree above is assembled off-document/);
  assert.match(source, /const thread = \$\(".editor-thread", detail\);\r?\n\s*if \(thread\) thread\.scrollTop = thread\.scrollHeight;/);
});

test("pasted and attached images are sent alongside the instruction, and cleared only after a successful send", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /function handleEditorPaste\(event, article\)/);
  assert.match(source, /images: state\.editorPendingImages\.map\(\(image\) => image\.dataUrl\),/);
  assert.match(source, /attachHeroImage: state\.editorAttachHero,/);
  assert.match(source, /state\.editorPendingImages = \[\];\r?\n\s*state\.editorAttachHero = false;\r?\n\s*thread\.push\(\{ role: "assistant"/);
});

test("the edit pane has a View pictures toggle that shows the actual selected images", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /function picturesGallery\(article\)/);
  assert.match(source, /state\.showPictures \? "Hide pictures ▲" : "View pictures ▼"/);
});
