import test from "node:test";
import assert from "node:assert/strict";
import { retryArticleUpdate } from "../api/update-article.js";

test("retry keeps editorial work but clears obsolete stopping state", () => {
  const current = {
    brief: { title_working: "Kept title", editor_override: { creative_license: true } },
    draft: "Kept draft",
    draft_meta: { claims_to_verify: ["One claim"] },
    critique_log: [{ verdict: "fail" }],
  };
  const changes = retryArticleUpdate(current);
  assert.equal(changes.status, "submitted");
  assert.equal(changes.draft_round, 0);
  assert.deepEqual(changes.critique_log, []);
  assert.equal(changes.brief.editor_override.creative_license, true);
  assert.equal(changes.draft, "Kept draft");
  assert.deepEqual(changes.draft_meta, current.draft_meta);
  assert.equal(changes.final_notes, null);
});
