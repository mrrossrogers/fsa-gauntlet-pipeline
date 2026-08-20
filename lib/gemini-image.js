const GEMINI_MODEL = "gemini-3-pro-image";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function env(name) {
  return String(process.env[name] || "").trim();
}

/**
 * Parses a browser-supplied `data:image/...;base64,...` upload into its raw
 * mime type and base64 payload. Returns null for anything else, including
 * remote URLs -- this is only for decoding a direct file upload, not for
 * fetching an already-stored image.
 */
export function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  return { mimeType: match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1], data: match[2] };
}

// Fetches an already-stored reference image (a Supabase Storage public URL)
// and base64-encodes it for use as Gemini inline-conditioning input. Skips
// anything that fails to fetch rather than failing the whole generation --
// a missing reference photo should not block the rest of the reference pack
// from being used as conditioning.
async function fetchAsInlinePart(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const mimeType = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return { inlineData: { mimeType, data: buffer.toString("base64") } };
  } catch {
    return null;
  }
}

// Genuine uncertainty flag: this is a newer Gemini model (aka "Nano Banana
// Pro") and its exact request/response JSON shape has not been verified
// against a live call from this codebase. The request body follows Gemini's
// documented generateContent conventions (camelCase inlineData/mimeType,
// responseModalities) as closely as published, and the response parsing
// below defensively checks both camelCase and snake_case field names in case
// the actual API differs from what's documented here. If this breaks, the
// fix is almost certainly in parseGeminiImageResponse below, not in how the
// request is built.
async function buildRequestBody({ prompt, referenceImageUrls }) {
  const parts = [{ text: prompt }];
  const inlineParts = await Promise.all((referenceImageUrls || []).slice(0, 3).map(fetchAsInlinePart));
  for (const part of inlineParts) if (part) parts.push(part);
  return {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE"] },
  };
}

function parseGeminiImageResponse(payload) {
  const candidates = payload?.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        const mimeType = inline.mimeType || inline.mime_type || "image/png";
        return { mimeType, base64: inline.data };
      }
    }
  }
  return null;
}

/**
 * Generates an image with Gemini's image model, optionally conditioned on up
 * to 3 reference images (image-to-image / reference-conditioned generation
 * rather than text-only prompting). Pass an empty referenceImageUrls array
 * for atmosphere/mood-only shots that have no specific real subject to
 * match.
 *
 * Throws on any failure -- callers should let this propagate like any other
 * agent-call failure in this codebase (falls through to the outer 500
 * handler, article status stays unchanged, naturally retryable).
 */
export async function generateGeminiImage({ prompt, referenceImageUrls = [] }) {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  if (!prompt || !prompt.trim()) throw new Error("An image prompt is required.");

  const response = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await buildRequestBody({ prompt, referenceImageUrls })),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini image generation failed (${response.status}).`;
    throw new Error(message);
  }

  const image = parseGeminiImageResponse(payload);
  if (!image) throw new Error("Gemini did not return an image. Try again or adjust the prompt.");
  return image;
}
