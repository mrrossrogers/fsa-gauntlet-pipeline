// api/post-to-website.js
// POST /api/post-to-website { id }
// For an article at ready_for_review: formats the approved draft into the
// live site's structured story shape (via the Publisher agent), appends it
// to food-sex-alcohol1's src/data/stories.ts (the gauntletStories array),
// and commits directly to that repo's main branch -- Vercel auto-deploys it
// from there. On success, marks the gauntlet article published.
//
// Requires the site repo's stories.ts to already export an empty
// `gauntletStories: Story[] = []` array merged into the final `stories`
// export -- that's a one-time, additive-only change made directly in
// food-sex-alcohol1, separate from this repo.

import { getSupabase } from '../lib/supabase.js';
import { callClaude } from '../lib/claude.js';
import { getFile, putFile } from '../lib/github.js';
import { PUBLISHER } from '../lib/prompts.js';

const STORIES_PATH = 'src/data/stories.ts';
const AUTHOR = 'Ross Rogers';
const GAUNTLET_MARKER = 'export const gauntletStories: Story[] = [';

// Matches the site's own categoryDetails mapping in stories.ts -- kept as a
// literal here rather than a live reference into that file, so this doesn't
// depend on the target file's internal variable names staying stable.
const CATEGORY_DETAILS = {
  food: { emotion: 'Belonging', outcome: 'Leave more connected than you arrived' },
  sex: { emotion: 'Intimacy', outcome: 'Feel seen, wanted and closer' },
  alcohol: { emotion: 'Celebration', outcome: 'Turn a passing moment into an occasion' },
};

function slugify(value) {
  return String(value).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || `story-${Date.now()}`;
}

// Escapes a string for embedding inside a single-quoted TS string literal in
// the generated source file. Distinct from HTML escaping -- this guards
// against a stray quote or backslash breaking the generated TypeScript.
function tsString(value) {
  return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function buildStoryEntry({ article, formatted, slug, identifier, categoryUpper }) {
  const details = CATEGORY_DETAILS[article.category];
  return `  {
    identifier: ${tsString(identifier)},
    headline: ${tsString(article.brief?.title_working || article.brief?.subject || 'Untitled')},
    slug: ${tsString(slug)},
    primaryCategory: ${tsString(categoryUpper)},
    description: ${tsString(formatted.description)},
    author: ${tsString(AUTHOR)},
    publicationDate: ${tsString(new Date().toISOString().slice(0, 10))},
    heroImage: ${tsString(article.image_url)},
    heroImageDescription: ${tsString(formatted.heroImageDescription)},
    moment: ${tsString(formatted.moment)},
    tone: ${tsString(article.category)},
    emotion: ${tsString(details.emotion)},
    outcome: ${tsString(details.outcome)},
    articleIntroduction: ${tsString(formatted.articleIntroduction)},
    articleSections: ${JSON.stringify(formatted.articleSections)},
    articleQuote: ${tsString(formatted.articleQuote)},
    planningNotes: ${JSON.stringify(formatted.planningNotes)},
    editorialConclusion: ${tsString(formatted.editorialConclusion)},
    relatedStorySlugs: [],
    featured: false,
    publicationStatus: 'published',
  },`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { data: article, error: fetchErr } = await supabase.from('fsa_articles').select('*').eq('id', id).single();
    if (fetchErr || !article) return res.status(404).json({ error: 'article not found' });
    if (article.status !== 'ready_for_review') {
      return res.status(400).json({
        error: `can only post an article at ready_for_review (current status: ${article.status})`,
      });
    }
    if (!article.image_url) {
      return res.status(400).json({ error: 'article has no image_url -- cannot publish without a hero image' });
    }

    const formatted = await callClaude(PUBLISHER, JSON.stringify({
      draft: article.draft, brief: article.brief, image_brief: article.image_brief,
    }), { maxTokens: 8192 });

    const title = article.brief?.title_working || article.brief?.subject || 'Untitled';
    const slug = slugify(title);
    const categoryUpper = article.category.toUpperCase();

    const { content, sha } = await getFile(STORIES_PATH);

    if (content.includes(`slug: '${slug}'`) || content.includes(`slug: "${slug}"`)) {
      return res.status(409).json({ error: `a story with slug "${slug}" already exists on the site` });
    }

    const markerIndex = content.indexOf(GAUNTLET_MARKER);
    if (markerIndex === -1) {
      throw new Error(
        'stories.ts does not have the expected "gauntletStories" array. ' +
        'It needs a one-time addition on the site repo: export const gauntletStories: Story[] = [], ' +
        'merged into the exported `stories` list.'
      );
    }
    const insertAt = markerIndex + GAUNTLET_MARKER.length;

    // Number gauntlet-published pieces by how many are already in the
    // gauntletStories block, rather than touching the original seeds'
    // numbering -- avoids any collision with the hand-authored "01".."15".
    const closeIndex = content.indexOf('\n];', insertAt);
    const existingBlock = closeIndex === -1 ? '' : content.slice(insertAt, closeIndex);
    const existingCount = (existingBlock.match(/identifier:/g) || []).length;
    const identifier = `G${String(existingCount + 1).padStart(2, '0')}`;

    const entry = buildStoryEntry({ article, formatted, slug, identifier, categoryUpper });
    const updatedContent = content.slice(0, insertAt) + '\n' + entry + content.slice(insertAt);

    await putFile(STORIES_PATH, updatedContent, sha, `Publish: ${title} (via FSA Gauntlet)`);

    const liveUrl = `https://www.foodsexalcohol.com/${article.category}/${slug}`;
    await supabase.from('fsa_articles').update({
      status: 'published', final_decision: 'publish', final_notes: liveUrl,
    }).eq('id', id);

    return res.status(200).json({ id, status: 'published', url: liveUrl });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
