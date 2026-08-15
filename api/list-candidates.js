import { requireOwner } from "../lib/auth.js";
import { getSupabase } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!requireOwner(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  try {
    const { data, error } = await getSupabase()
      .from("fsa_content_candidates")
      .select("*")
      .in("status", ["pending", "parked"])
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.status(200).json({ candidates: data });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load candidates." });
  }
}


