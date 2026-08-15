import test from "node:test";
import assert from "node:assert/strict";
import { critiqueRoute, normalizedCritique } from "../api/process-article.js";

function critique({ verdict = "revise", disposition = "revision", severity = "major" } = {}) {
  return normalizedCritique({
    verdict,
    notes: [{ disposition, severity, quote: "text", problem: "problem", fix: "fix" }],
  });
}

test("material revisions return to the writer before the final automatic round", () => {
  assert.equal(critiqueRoute([critique()], 1), "briefed");
});

test("residual editorial revisions proceed to owner review after three rounds", () => {
  assert.equal(critiqueRoute([critique()], 3), "text_approved");
});

test("observations do not stop an article", () => {
  assert.equal(critiqueRoute([critique({ verdict: "pass", disposition: "observation", severity: "minor" })], 1), "text_approved");
});

test("a true block always requires the owner", () => {
  assert.equal(critiqueRoute([critique({ verdict: "fail", disposition: "block", severity: "blocking" })], 1), "needs_human");
});

test("legacy blocking failures are normalized as blocks", () => {
  const legacy = normalizedCritique({
    verdict: "fail",
    notes: [{ severity: "blocking", quote: "text", problem: "problem", fix: "fix" }],
  });
  assert.equal(legacy.notes[0].disposition, "block");
  assert.equal(legacy.verdict, "fail");
});
