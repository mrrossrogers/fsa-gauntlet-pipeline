import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the funnel has All/Food/Sex/Alcohol tabs with live counts", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /class="tabs candidate-tabs"/);
  assert.match(html, /data-room="all"/);
  assert.match(html, /data-room="food"/);
  assert.match(html, /data-room="sex"/);
  assert.match(html, /data-room="alcohol"/);
  assert.match(html, /id="room-count-all"/);
});

test("inRoom matches a candidate on either its primary or secondary category, so a Food+Alcohol idea shows under both tabs", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /function inRoom\(candidate, room\) \{/);
  assert.match(source, /room === "all" \|\| candidate\.category === room \|\| candidate\.secondary_category === room/);
  assert.match(source, /const visible = state\.candidates\.filter\(\(candidate\) => inRoom\(candidate, state\.funnelRoom\)\);/);
  assert.match(source, /tab\.addEventListener\("click", \(\) => \{\s*state\.funnelRoom = tab\.dataset\.room;/);
});
