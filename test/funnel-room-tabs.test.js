import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the funnel has All/Food/Sex/Alcohol tabs with live counts, using their own class so they never touch the top-level tab switcher", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /class="candidate-tabs"/);
  assert.match(html, /class="room-tab-btn active"/);
  assert.doesNotMatch(html, /class="tab-btn active"[^>]*data-room=/);
  assert.match(html, /data-room="all"/);
  assert.match(html, /data-room="food"/);
  assert.match(html, /data-room="sex"/);
  assert.match(html, /data-room="alcohol"/);
  assert.match(html, /id="room-count-all"/);
});

test("room-tab-btn is a distinct class from tab-btn, so app.js's blanket .tab-btn click listener (the Gauntlet/Content Funnel switcher) can never fire on a room filter click and blank out every panel", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /\$\$\("\.tab-btn"\)\.forEach\(\(tab\) => tab\.addEventListener\("click", \(\) => switchTab\(tab\.dataset\.tab\)\)\);/);
  assert.doesNotMatch(source, /\$\$\("\.candidate-tabs \.tab-btn"\)/);
  assert.match(source, /\$\$\("\.candidate-tabs \.room-tab-btn"\)/);
});

test("inRoom matches a candidate on either its primary or secondary category, so a Food+Alcohol idea shows under both tabs", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /function inRoom\(candidate, room\) \{/);
  assert.match(source, /room === "all" \|\| candidate\.category === room \|\| candidate\.secondary_category === room/);
  assert.match(source, /const visible = state\.candidates\.filter\(\(candidate\) => inRoom\(candidate, state\.funnelRoom\)\);/);
  assert.match(source, /tab\.addEventListener\("click", \(\) => \{\s*state\.funnelRoom = tab\.dataset\.room;/);
});
