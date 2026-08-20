import { createClient } from "@supabase/supabase-js";

let client;

export function getSupabase() {
  if (client) return client;
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!url || !key) throw new Error("Supabase is not configured.");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function cleanText(value, max = 5000) {
  return String(value || "")
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\s*&mdash;\s*/gi, ", ")
    .trim()
    .slice(0, max);
}

export function validCategory(value) {
  return ["food", "sex", "alcohol"].includes(value);
}

export function validFormatLane(value) {
  return ["essay", "reported"].includes(value);
}

export function safeHttpsUrl(value) {
  const text = cleanText(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeCandidate(value) {
  return cleanText(value, 500)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

