import "./env.js";
import jwt from "jsonwebtoken";

// Single-operator admin auth. Credentials come from the environment
// (ADMIN_USER / ADMIN_PASS); in development (non-production) they fall back
// to admin/admin so local runs and tests work out of the box.
const isProduction = process.env.NODE_ENV === "production";

export const ADMIN_USER = process.env.ADMIN_USER || "admin";
export const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
export const JWT_SECRET =
  process.env.JWT_SECRET || "kashida-dev-secret-change-me-in-production";
export const TOKEN_TTL = "7d";

export function isAuthConfigured() {
  if (!isProduction) return true; // dev fallback creds are always usable
  return Boolean(
    process.env.ADMIN_USER && process.env.ADMIN_PASS && process.env.JWT_SECRET,
  );
}

export function checkCredentials(username, password) {
  return (
    typeof username === "string" &&
    typeof password === "string" &&
    username === ADMIN_USER &&
    password === ADMIN_PASS
  );
}

export function signToken(username) {
  return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Pull the bearer token from the Authorization header or a ?token= query
// param (the latter lets <img> tags load authenticated serve URLs).
function extractToken(req) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  if (typeof req.query?.token === "string") return req.query.token.trim();
  return null;
}

// 401 when no/expired token, otherwise attach { username } to req.user.
export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "authentication required" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { username: payload.sub };
    return next();
  } catch {
    return res.status(401).json({ error: "invalid or expired token" });
  }
}

// Async-friendly variant for route handlers that need a resolved auth result.
export function authenticate(req, res) {
  const token = extractToken(req);
  if (!token)
    return { ok: false, status: 401, error: "authentication required" };
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { ok: true, username: payload.sub };
  } catch {
    return { ok: false, status: 401, error: "invalid or expired token" };
  }
}
