const API_URL = "https://api.anthropic.com/v1/messages";
const SAFE_MODELS = ["claude-sonnet-5", "claude-sonnet-4-6"];
const SAFE_MODEL = SAFE_MODELS[0];
const RETIRED_MODELS = new Set(["claude-sonnet-4-20250514", "claude-sonnet-4"]);

function model() {
  const configured = String(process.env.ANTHROPIC_MODEL || SAFE_MODEL).trim();
  return RETIRED_MODELS.has(configured) ? SAFE_MODEL : configured;
}

function cleanErrorBody(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 500);
}

async function requestClaude(body) {
  const key = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const candidates = [...new Set([body.model, ...SAFE_MODELS])];
  let lastError;
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ ...body, model: candidate }),
      });
      if (response.ok) return response.json();
      const detail = cleanErrorBody(await response.text());
      lastError = new Error(`Claude request failed (${response.status}): ${detail}`);
      const invalidModel = [400, 404].includes(response.status) && /model/i.test(detail) && /(invalid|not found|not available|unsupported)/i.test(detail);
      if (invalidModel && candidate !== SAFE_MODEL) break;
      if (![429, 500, 529].includes(response.status) || attempt === 1) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function enforceHouseStyle(value) {
  if (typeof value === "string") {
    const styled = value.replace(/\s*\u2014\s*/g, ", ").replace(/\s*&mdash;\s*/gi, ", ");
    const artifact = styled.search(/<\/[a-z0-9_]+>\s*<|<parameter\s+name=/i);
    return (artifact >= 0 ? styled.slice(0, artifact) : styled)
      .replace(/^\s*<[a-z0-9_]+>\s*/i, "")
      .replace(/\s*<\/[a-z0-9_]+>\s*$/i, "")
      .trim();
  }
  if (Array.isArray(value)) return value.map(enforceHouseStyle);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, enforceHouseStyle(item)]));
  }
  return value;
}

// Accepts either a single legacy imageUrl (kept for existing callers like the
// Photo Critic) or an images array mixing remote URLs ({ url }) and pasted
// uploads ({ dataUrl }, a browser data: URL). Capped at 4 images per call --
// this feeds a chat UI, not a bulk-image pipeline.
export function buildAgentRequest({ name, system, schema, input, maxTokens = 2500, imageUrl = "", images = [] }) {
  const content = [];
  const allImages = [...(imageUrl ? [{ url: imageUrl }] : []), ...images].slice(0, 4);
  for (const image of allImages) {
    if (image.url) {
      content.push({ type: "image", source: { type: "url", url: image.url } });
    } else if (image.dataUrl) {
      const match = /^data:([^;,]+);base64,(.+)$/.exec(image.dataUrl);
      if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
    }
  }
  content.push({ type: "text", text: typeof input === "string" ? input : JSON.stringify(input) });

  const toolName = `submit_${name.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  return {
    model: model(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    tools: [{
      name: toolName,
      description: "Return the completed editorial result in the required structure.",
      input_schema: schema,
    }],
    tool_choice: { type: "tool", name: toolName },
  };
}

export async function callAgent(options) {
  const request = buildAgentRequest(options);
  const toolName = request.tools[0].name;
  const data = await requestClaude(request);

  const result = data.content?.find((block) => block.type === "tool_use" && block.name === toolName)?.input;
  if (!result || typeof result !== "object") throw new Error(`${options.name} did not return a structured result.`);
  return enforceHouseStyle(result);
}
