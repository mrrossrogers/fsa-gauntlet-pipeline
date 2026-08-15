import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "fsa_owner_session";
export const SESSION_SECONDS = 60 * 60 * 12;

function env(name) {
  return String(process.env[name] || "").trim();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function authConfigured() {
  if (accessMode() === "platform") return true;
  return Boolean(env("FSA_OWNER_PASSWORD") && env("FSA_SESSION_SECRET"));
}

export function accessMode() {
  return env("FSA_ACCESS_MODE").toLowerCase() === "password" ? "password" : "platform";
}

export function passwordMatches(value) {
  const expected = env("FSA_OWNER_PASSWORD");
  return Boolean(expected) && safeEqual(digest(value), digest(expected));
}

export function createSession(now = Date.now()) {
  const secret = env("FSA_SESSION_SECRET");
  if (!secret) throw new Error("FSA_SESSION_SECRET is not configured.");
  const payload = Buffer.from(JSON.stringify({
    role: "owner",
    expiresAt: Math.floor(now / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySession(token, now = Date.now()) {
  const secret = env("FSA_SESSION_SECRET");
  if (!token || !secret) return false;
  const [payload, supplied, extra] = String(token).split(".");
  if (!payload || !supplied || extra || !safeEqual(signature(payload, secret), supplied)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.role === "owner" && Number(data.expiresAt) > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf("=");
      return index === -1 ? [entry, ""] : [entry.slice(0, index), decodeURIComponent(entry.slice(index + 1))];
    }));
}

export function requestIsOwner(req) {
  if (accessMode() === "platform") return true;
  return verifySession(parseCookies(req)[SESSION_COOKIE]);
}

export function requestHasCronSecret(req) {
  const secret = env("FSA_CRON_SECRET");
  const header = String(req.headers.authorization || "");
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(secret && supplied && safeEqual(digest(supplied), digest(secret)));
}

export function requireOwner(req, res) {
  if (!authConfigured()) {
    res.status(503).json({ error: "Owner authentication is not configured." });
    return false;
  }
  if (!requestIsOwner(req)) {
    res.status(401).json({ error: "Owner session required." });
    return false;
  }
  return true;
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

