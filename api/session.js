import { accessMode, authConfigured, requestIsOwner } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  return res.status(200).json({
    mode: accessMode(),
    configured: authConfigured(),
    authenticated: requestIsOwner(req),
  });
}

