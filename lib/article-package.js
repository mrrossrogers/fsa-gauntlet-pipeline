function clean(value, max = 50000) {
  const styled = String(value || "")
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\s*&mdash;\s*/gi, ", ");
  const artifact = styled.search(/<\/[a-z0-9_]+>\s*<|<parameter\s+name=/i);
  return (artifact >= 0 ? styled.slice(0, artifact) : styled)
    .replace(/^\s*<[a-z0-9_]+>\s*/i, "")
    .replace(/\s*<\/[a-z0-9_]+>\s*$/i, "")
    .trim()
    .slice(0, max);
}

function slugify(value) {
  return clean(value, 180)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "untitled-article";
}

function cleanDraft(value) {
  const source = clean(value).replace(/^\s*<draft>\s*/i, "");
  const artifact = source.search(/<\/draft>\s*<parameter\b|<parameter\s+name=/i);
  return (artifact >= 0 ? source.slice(0, artifact) : source).replace(/<\/draft>\s*$/i, "").trim();
}

function yaml(value) {
  return JSON.stringify(clean(value));
}

function yamlArray(key, values, indent = "") {
  const items = (Array.isArray(values) ? values : []).map((value) => clean(value)).filter(Boolean);
  return items.length
    ? `${indent}${key}:\n${items.map((value) => `${indent}  - ${yaml(value)}`).join("\n")}`
    : `${indent}${key}: []`;
}

const categoryDefaults = {
  food: { emotion: "Belonging", tone: "gold", hero: "https://www.foodsexalcohol.com/images/food.png" },
  sex: { emotion: "Intimacy", tone: "wine", hero: "https://www.foodsexalcohol.com/images/romance.png" },
  alcohol: { emotion: "Celebration", tone: "amber", hero: "https://www.foodsexalcohol.com/images/hero.png" },
};

const formatMap = {
  reported_feature: "feature",
  essay: "essay",
  service: "guide",
  recipe: "recipe",
  review: "review",
};

export function buildArticlePackage(article, { status = "draft", today = new Date() } = {}) {
  const brief = article?.brief || {};
  const title = clean(brief.title_working || brief.subject || article?.seed, 300);
  const slug = slugify(brief.slug || title);
  const category = ["food", "sex", "alcohol"].includes(article?.category) ? article.category : "food";
  const defaults = categoryDefaults[category];
  const assets = Array.isArray(article?.image_brief?.assets) ? article.image_brief.assets : [];
  const hero = assets.find((asset) => asset?.role === "hero") || assets[0] || {};
  const recommendation = brief.editor_recommendation || {};
  const published = status === "published";
  const date = today.toISOString().slice(0, 10);
  const identifier = String(brief.identifier || article?.identifier || "01").padStart(2, "0").slice(-2);
  const verdictLabel = recommendation.fsa_verdict
    ? recommendation.fsa_verdict.replaceAll("_", " ").toUpperCase()
    : "";
  const verdict = clean(
    [verdictLabel, recommendation.reasoning].filter(Boolean).join(": ") || "Editor review required before publication.",
    500,
  );
  const body = cleanDraft(article?.draft);
  const savedHeroUrl = clean(hero.url || article?.image_url);
  const heroUrl = /\/images\/fsa-(?:food|sex|alcohol)-editorial\.png(?:$|\?)/i.test(savedHeroUrl)
    ? defaults.hero
    : savedHeroUrl || defaults.hero;

  const frontmatter = [
    "---",
    `identifier: ${yaml(identifier)}`,
    `title: ${yaml(title)}`,
    `seoTitle: ${yaml(clean(brief.seo_title || title, 70))}`,
    `slug: ${yaml(slug)}`,
    `category: ${yaml(category.toUpperCase())}`,
    `format: ${yaml(formatMap[brief.format] || "feature")}`,
    `issue: ${yaml(article?.issue === "current" ? "01" : article?.issue || "01")}`,
    `dek: ${yaml(brief.dek || brief.reader_promise || article?.angle)}`,
    `primaryKeyword: ${yaml(brief.primary_keyword || title)}`,
    yamlArray("secondaryKeywords", brief.secondary_keywords),
    `searchIntent: ${yaml(brief.search_intent || brief.reader_question || brief.reader_promise)}`,
    `moment: ${yaml(brief.human_moment || brief.reader_question || article?.angle || "For a moment worth using well")}`,
    `emotion: ${yaml(defaults.emotion)}`,
    `outcome: ${yaml(brief.time_value?.potential_return || brief.reader_next_move?.description || brief.reader_promise || brief.dek || "Make a more considered choice")}`,
    `tone: ${yaml(defaults.tone)}`,
    `author: ${yaml("Ross Rogers")}`,
    ...(published ? [`publishedAt: ${date}`] : []),
    `modifiedAt: ${date}`,
    `status: ${yaml(status)}`,
    `featured: ${brief.featured ? "true" : "false"}`,
    "hero:",
    `  src: ${yaml(heroUrl)}`,
    `  alt: ${yaml(hero.alt || `FSA editorial image for ${title}`)}`,
    ...(hero.caption ? [`  caption: ${yaml(hero.caption)}`] : []),
    ...(hero.credit ? [`  credit: ${yaml(hero.credit)}`] : []),
    ...(hero.source_url ? [`  sourceUrl: ${yaml(hero.source_url)}`] : []),
    `verdict: ${yaml(verdict)}`,
    yamlArray("planningNotes", recommendation.final_checks),
    yamlArray("relatedSlugs", brief.related_slugs),
    "products: []",
    "---",
    "",
    body,
    "",
  ].join("\n");

  return {
    fileName: `${slug}.md`,
    path: `src/content/stories/${slug}.md`,
    slug,
    markdown: frontmatter,
  };
}
