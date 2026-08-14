// lib/claude.js
// Shared helper for calling the Anthropic Messages API and parsing a strict
// JSON response. Every FSA agent prompt (see lib/prompts.js) instructs Claude
// to reply with exactly one JSON object -- this is the one place that call
// pattern lives, instead of being duplicated per API route.

export async function callClaude(system, userContent) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing required env var: ANTHROPIC_API_KEY');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      // Sonnet 5 runs adaptive thinking by default when `thinking` is
      // omitted, and max_tokens caps thinking + response text together.
      // Every agent here wants a single structured JSON object back, not
      // deliberation, so disable it explicitly -- otherwise thinking can
      // silently eat the budget and truncate the response mid-sentence.
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  const data = await res.json();

  // Surface the real Anthropic error instead of falling through to an empty
  // string and a cryptic "Unexpected end of JSON input" from JSON.parse('').
  if (!res.ok) {
    throw new Error(`Anthropic API error (${res.status}): ${data.error?.message || JSON.stringify(data)}`);
  }

  const text = data.content?.map(b => b.text || '').join('\n') ?? '';
  const clean = text.replace(/```json|```/g, '').trim();
  if (!clean) {
    throw new Error(`Claude returned no parseable content. Raw response: ${JSON.stringify(data)}`);
  }

  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Claude response wasn't valid JSON: ${clean.slice(0, 500)}`);
  }
}
