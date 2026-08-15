import test from "node:test";
import assert from "node:assert/strict";
import { fallbackImage } from "../lib/auto-image.js";
import { buildArticlePackage } from "../lib/article-package.js";

test("each desk receives a deployed FSA fallback image", () => {
  assert.equal(fallbackImage("food").asset.url, "https://www.foodsexalcohol.com/images/food.png");
  assert.equal(fallbackImage("sex").asset.url, "https://www.foodsexalcohol.com/images/romance.png");
  assert.equal(fallbackImage("alcohol").asset.url, "https://www.foodsexalcohol.com/images/hero.png");
});

test("article packages replace legacy broken editorial image paths", () => {
  const articlePackage = buildArticlePackage({
    category: "sex",
    issue: "current",
    seed: "A useful article",
    angle: "A clear angle",
    draft: "Article body.",
    brief: { title_working: "A Useful Article", format: "essay" },
    image_url: "https://process-article.vercel.app/images/fsa-sex-editorial.png",
  });
  assert.match(articlePackage.markdown, /https:\/\/www\.foodsexalcohol\.com\/images\/romance\.png/);
  assert.doesNotMatch(articlePackage.markdown, /fsa-sex-editorial\.png/);
});
