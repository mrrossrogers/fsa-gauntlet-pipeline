import { authConfigured, createSession, passwordMatches, sessionCookie } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!authConfigured()) return res.status(503).json({ error: "Owner authentication is not configured." });
  const password = String((req.body || {}).password || "");
  if (!passwordMatches(password)) return res.status(401).json({ error: "That password did not match." });
  res.setHeader("Set-Cookie", sessionCookie(createSession()));
  return res.status(200).json({ ok: true });
}


