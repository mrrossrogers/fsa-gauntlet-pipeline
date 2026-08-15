// lib/github.js
// Minimal GitHub Contents API client for pushing a published article into
// the live foodsexalcohol.com site's repo (food-sex-alcohol1). Uses a
// fine-grained PAT (FSA_SITE_GITHUB_TOKEN) scoped to just that one repo.

const OWNER = 'mrrossrogers';
const REPO = 'food-sex-alcohol1';
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;

function authHeaders() {
  if (!process.env.FSA_SITE_GITHUB_TOKEN) {
    throw new Error('Missing required env var: FSA_SITE_GITHUB_TOKEN');
  }
  return {
    authorization: `Bearer ${process.env.FSA_SITE_GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
}

export async function getFile(path, ref = 'main') {
  const res = await fetch(`${API_BASE}/contents/${path}?ref=${ref}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GitHub API error fetching ${path} (${res.status}): ${data.message || JSON.stringify(data)}`);
  }
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

export async function putFile(path, content, sha, message) {
  const res = await fetch(`${API_BASE}/contents/${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      sha,
      branch: 'main',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GitHub API error writing ${path} (${res.status}): ${data.message || JSON.stringify(data)}`);
  }
  return data;
}
