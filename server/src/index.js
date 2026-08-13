import "./env.js";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET, isR2Configured } from "./r2.js";
import pool from "./db.js";
import { ai, GEMINI_MODEL, isGeminiConfigured } from "./gemini.js";
import { parseTags } from "./tagParser.js";
import initDb from "./initDb.js";

const app = express();
const PORT = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === "production";
let dbReady = false;

// Initialize database asynchronously with error handling.
// App starts immediately even if DB init fails, allowing graceful degradation,
// and keeps retrying in the background so a transiently-unreachable DB at boot
// does not leave the service 503 forever.
async function ensureDb() {
  if (dbReady) return;
  try {
    dbReady = await initDb();
  } catch (err) {
    console.error("[app] Database initialization failed:", err.message);
    dbReady = false;
  }
  if (!dbReady) {
    console.error("[app] App is running in degraded mode. Retrying in 30s…");
    setTimeout(ensureDb, 30000).unref();
  }
}
// Await the first init attempt inside request handlers so a boot-time request
// does not 503 while init is still racing to finish.
const dbInit = ensureDb();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

// Minimal in-memory rate limiter for cost-bearing endpoints (no external deps).
function makeRateLimit({ windowMs, max }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, rec] of hits) {
      if (now > rec.reset) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();
  return (req, res, next) => {
    const now = Date.now();
    const rec = hits.get(req.ip) || { count: 0, reset: now + windowMs };
    if (now > rec.reset) {
      rec.count = 0;
      rec.reset = now + windowMs;
    }
    rec.count += 1;
    if (rec.count > max) {
      return res.status(429).json({ error: "too many requests, slow down" });
    }
    hits.set(req.ip, rec);
    next();
  };
}
const RATE_UPLOAD = makeRateLimit({ windowMs: 60_000, max: 120 });
const RATE_TAG = makeRateLimit({ windowMs: 60_000, max: 60 });

app.get("/api/health", async (req, res) => {
  await dbInit;
  res.json({ ok: true, service: "smart-image-archive", db: dbReady });
});

app.use("/api", async (req, res, next) => {
  if (dbReady) return next();
  await dbInit;
  if (dbReady) return next();
  res.status(503).json({
    error:
      "database not ready — check DATABASE_URL or the server logs for the connection error",
  });
});

const ALLOWED_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|heic|tiff|raw)$/i;
const MIME_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

app.post("/api/upload-url", RATE_UPLOAD, async (req, res) => {
  const { filename, contentType } = req.body || {};

  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ error: "filename is required" });
  }

  const extMatch = filename.match(ALLOWED_EXTENSIONS);
  if (!extMatch) {
    return res.status(400).json({ error: "unsupported file extension" });
  }

  if (
    contentType !== undefined &&
    (typeof contentType !== "string" ||
      contentType.length > 200 ||
      !MIME_RE.test(contentType))
  ) {
    return res.status(400).json({ error: "invalid contentType" });
  }

  if (!isR2Configured()) {
    return res
      .status(500)
      .json({ error: "R2 is not configured on the server" });
  }

  const objectKey = `uploads/${randomUUID()}${extMatch[0].toLowerCase()}`;

  try {
    const uploadUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: objectKey,
        ContentType: contentType || "application/octet-stream",
      }),
      { expiresIn: 60 },
    );

    res.json({ objectKey, uploadUrl });
  } catch (err) {
    console.error("Presign failed:", err.message);
    res.status(500).json({ error: "failed to generate upload URL" });
  }
});

app.post("/api/images", async (req, res) => {
  const { objectKey, originalFilename } = req.body || {};
  const invalidKey =
    typeof objectKey !== "string" ||
    objectKey.length === 0 ||
    objectKey.length > 512 ||
    objectKey.includes("\0");
  const invalidFilename =
    typeof originalFilename !== "string" ||
    originalFilename.length === 0 ||
    originalFilename.length > 512 ||
    originalFilename.includes("\0");
  if (invalidKey || invalidFilename) {
    return res
      .status(400)
      .json({ error: "objectKey and originalFilename are required" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO images (object_key, original_filename) VALUES ($1, $2)
       RETURNING id, object_key, original_filename, tags, created_at`,
      [objectKey, originalFilename],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "image already saved" });
    }
    console.error("Save image failed:", err.message);
    res.status(500).json({ error: "failed to save image" });
  }
});

const SEARCH_LIMIT = 100;

function publicUrl(publicBase, objectKey) {
  const encoded = objectKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  if (!publicBase || publicBase.includes("example.com")) {
    return `/api/images/serve/${encoded}`;
  }
  return `${publicBase}/${encoded}`;
}

app.get("/api/images", async (req, res) => {
  const view = req.query.view || "all";
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

  let where = "deleted = false";
  if (view === "trash") where = "deleted = true";
  else if (view === "favorites") where = "deleted = false AND favorite = true";

  try {
    const { rows } = await pool.query(
      `SELECT id, object_key, original_filename, tags, favorite, deleted, created_at
       FROM images WHERE ${where}
       ORDER BY created_at DESC LIMIT 200`,
    );
    res.json(
      rows.map((row) => ({ ...row, url: publicUrl(publicBase, row.object_key) })),
    );
  } catch (err) {
    console.error("List images failed:", err.message);
    res.status(500).json({ error: "failed to list images" });
  }
});

// /api/images/tag is a real POST route; guard the other methods from being
// captured by the :objectKey param route below (e.g. GET would otherwise
// run a DB lookup for object_key = 'tag').
app.get("/api/images/tag", (_req, res) =>
  res.status(405).json({ error: "method not allowed" }),
);
app.patch("/api/images/tag", (_req, res) =>
  res.status(405).json({ error: "method not allowed" }),
);
app.delete("/api/images/tag", (_req, res) =>
  res.status(405).json({ error: "method not allowed" }),
);

app.get("/api/images/serve/*", async (req, res) => {
  const objectKey = req.params[0];
  if (!objectKey || objectKey.includes("\0")) {
    return res.status(400).json({ error: "invalid objectKey" });
  }
  if (!isR2Configured()) {
    return res.status(503).json({ error: "R2 is not configured" });
  }
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey,
    });
    const response = await r2.send(command);
    if (response.ContentType) {
      res.setHeader("Content-Type", response.ContentType);
    }
    if (response.ContentLength) {
      res.setHeader("Content-Length", response.ContentLength);
    }
    response.Body.pipe(res);
  } catch (err) {
    console.error("Serve image failed:", err.message);
    res.status(404).send("Not Found");
  }
});

app.get("/api/images/:objectKey", async (req, res) => {
  const { objectKey } = req.params;
  if (objectKey.includes("\0")) {
    return res.status(400).json({ error: "invalid objectKey" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, object_key, original_filename, tags, favorite, deleted, created_at
       FROM images WHERE object_key = $1 LIMIT 1`,
      [objectKey],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }
    const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
    res.json({ ...rows[0], url: publicUrl(publicBase, rows[0].object_key) });
  } catch (err) {
    console.error("Get image failed:", err.message);
    res.status(500).json({ error: "failed to get image" });
  }
});

app.patch("/api/images/:objectKey", async (req, res) => {
  const { objectKey } = req.params;
  if (objectKey.includes("\0")) {
    return res.status(400).json({ error: "invalid objectKey" });
  }
  const { tags, favorite, deleted } = req.body || {};

  const sets = [];
  const values = [];
  if (typeof tags === "string") {
    if (tags.length > 2000 || tags.includes("\0")) {
      return res.status(400).json({ error: "invalid tags" });
    }
    values.push(tags);
    sets.push(`tags = $${values.length}`);
  }
  if (typeof favorite === "boolean") {
    values.push(favorite);
    sets.push(`favorite = $${values.length}`);
  }
  if (typeof deleted === "boolean") {
    values.push(deleted);
    sets.push(`deleted = $${values.length}`);
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: "nothing to update" });
  }

  values.push(objectKey);
  try {
    const { rows } = await pool.query(
      `UPDATE images SET ${sets.join(", ")} WHERE object_key = $${values.length}
       RETURNING id, object_key, original_filename, tags, favorite, deleted, created_at`,
      values,
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Update image failed:", err.message);
    res.status(500).json({ error: "failed to update image" });
  }
});

app.delete("/api/images/:objectKey", async (req, res) => {
  const { objectKey } = req.params;
  if (objectKey.includes("\0")) {
    return res.status(400).json({ error: "invalid objectKey" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE images SET deleted = true WHERE object_key = $1 RETURNING id`,
      [objectKey],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error("Delete image failed:", err.message);
    res.status(500).json({ error: "failed to delete image" });
  }
});

function buildTsQuery(raw) {
  const terms = (String(raw).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((t) => t.length > 1)
    .slice(0, 50);
  if (terms.length === 0) return null;
  return terms.join(" | ");
}

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    return res.status(400).json({ error: "q query parameter is required" });
  }

  const tsQuery = buildTsQuery(q);
  if (!tsQuery) {
    return res.json([]);
  }

  const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const sort = req.query.sort || "rank";
  const orderBy =
    sort === "newest"
      ? "created_at DESC"
      : sort === "oldest"
        ? "created_at ASC"
        : "rank DESC, created_at DESC";

  try {
    const { rows } = await pool.query(
      `SELECT id, object_key, original_filename, tags, favorite, created_at,
              ts_rank(search_vector, to_tsquery('simple', $1)) AS rank
       FROM images
       WHERE search_vector @@ to_tsquery('simple', $1)
         AND deleted = false
       ORDER BY ${orderBy}
       LIMIT ${SEARCH_LIMIT}`,
      [tsQuery],
    );

    res.json(
      rows.map((row) => ({
        ...row,
        url: publicUrl(publicBase, row.object_key),
      })),
    );
  } catch (err) {
    console.error("Search failed:", err.message);
    res.status(500).json({ error: "search failed" });
  }
});

const DEFAULT_TAG_PROMPT = "Give me 5 descriptive keywords for this image.";
const MAX_TAG_IMAGE_BYTES = 10 * 1024 * 1024;

// imageUrl is attacker-controlled, so a fetch of it is an SSRF sink unless we
// pin it to the operator-configured storage origin (https by default).
function checkImageUrl(imageUrl) {
  const base = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return { ok: false, error: "imageUrl requires R2_PUBLIC_BASE_URL to be configured" };
  }
  let url;
  let origin;
  try {
    url = new URL(imageUrl);
    origin = new URL(base);
  } catch {
    return { ok: false, error: "invalid imageUrl" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "imageUrl must be http(s)" };
  }
  if (url.origin !== origin.origin) {
    return { ok: false, error: "imageUrl must be hosted by the configured storage origin" };
  }
  return { ok: true };
}

async function fetchTagImage(url) {
  const imageRes = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!imageRes.ok) throw new Error("image reference fetch failed");
  const type = imageRes.headers.get("content-type") || "";
  if (!/^image\//i.test(type)) {
    throw new Error("image reference is not an image");
  }
  if (imageRes.body) {
    const reader = imageRes.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_TAG_IMAGE_BYTES) throw new Error("image reference too large");
      chunks.push(value);
    }
    return { mime: type, data: Buffer.concat(chunks).toString("base64") };
  }
  const buf = Buffer.from(await imageRes.arrayBuffer());
  if (buf.byteLength > MAX_TAG_IMAGE_BYTES) throw new Error("image reference too large");
  return { mime: type, data: buf.toString("base64") };
}

app.post("/api/images/tag", RATE_TAG, async (req, res) => {
  const { objectKey, thumbnail, mimeType, imageUrl, prompt } = req.body || {};

  if (!objectKey || typeof objectKey !== "string" || objectKey.includes("\0")) {
    return res.status(400).json({ error: "objectKey is required" });
  }
  if (!isGeminiConfigured()) {
    return res
      .status(500)
      .json({ error: "Gemini is not configured on the server" });
  }

  let data = thumbnail;
  let mime = mimeType || "image/jpeg";

  if (!data && imageUrl) {
    if (typeof imageUrl !== "string" || !checkImageUrl(imageUrl).ok) {
      return res.status(400).json({ error: "invalid imageUrl" });
    }
    let fetched;
    try {
      fetched = await fetchTagImage(imageUrl);
    } catch {
      return res.status(502).json({ error: "failed to fetch image reference" });
    }
    mime = fetched.mime || mime;
    data = fetched.data;
  }

  if (!data || typeof data !== "string") {
    return res.status(400).json({ error: "thumbnail or imageUrl is required" });
  }

  const dataUrlMatch = data.match(/^data:([^;]+);base64,(.*)$/s);
  if (dataUrlMatch) {
    mime = dataUrlMatch[1];
    data = dataUrlMatch[2];
  }

  const userPrompt =
    typeof prompt === "string" && prompt.trim()
      ? prompt.trim()
      : DEFAULT_TAG_PROMPT;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        { inlineData: { mimeType: mime, data } },
        `${userPrompt}\nRespond ONLY with a JSON array of strings, e.g. ["tag1","tag2"].`,
      ],
    });

    const tags = parseTags(response.text);
    if (!tags) {
      return res
        .status(500)
        .json({ error: "Gemini response was not a tag array" });
    }

    const { rows } = await pool.query(
      `UPDATE images SET tags = $1 WHERE object_key = $2
       RETURNING id, object_key, original_filename, tags, created_at`,
      [tags.join(" "), objectKey],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }

    res.json({ objectKey, tags, image: rows[0] });
  } catch (err) {
    console.error("AI tagging failed:", err.message);
    res.status(500).json({ error: "AI tagging failed" });
  }
});

const CLIENT_DIST = fileURLToPath(
  new URL("../../client/dist/", import.meta.url),
);
if (isProduction && existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api(?:\/|$)).*/i, (_req, res) => {
    if (dbReady) return res.sendFile(`${CLIENT_DIST}/index.html`);
    res
      .status(503)
      .type("html")
      .send(
        `<!doctype html><html><body style="font-family:system-ui;background:#0b0f19;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
        <div style="max-width:560px;text-align:center"><h1>NewsLens</h1>
        <p>Database is not ready.</p>
        <p style="color:#94a3b8;font-size:14px">DATABASE_URL is not configured. Railway detected the issue and is attempting to connect. Please check the service logs for details.</p>
        <p style="color:#94a3b8;font-size:13px">If you deployed a Postgres database, ensure the DATABASE_URL variable is set to the connection string and redeploy.</p></div></body></html>`,
      );
  });
}

// Always start the server (removed the import.meta.url check that was causing it not to listen)
const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
// When imported by tests, several processes can race to bind PORT; tolerate
// EADDRINUSE instead of letting the 'error' event crash the process.
server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    console.error(
      `[app] Port ${PORT} already in use — module listener skipped (tests?)`,
    );
    return;
  }
  console.error("[app] Listener error:", err);
});

// JSON 404 for unmatched routes (including /api) and JSON error responses.
app.use((req, res) => {
  res.status(404).json({ error: "not found" });
});
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "request body too large" });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid JSON body" });
  }
  // Express and body-parser tag client mistakes with a 4xx statusCode
  // (bad %-escape in a path, unsupported charset, corrupt gzip body).
  // Surface those as the matching JSON error instead of an internal 500.
  if (err?.statusCode && err?.statusCode >= 400 && err?.statusCode < 500) {
    return res.status(err.statusCode).json({ error: "invalid request" });
  }
  console.error("Unhandled request error:", err);
  res.status(500).json({ error: "internal server error" });
});

function shutdown(signal) {
  console.log(`[app] ${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, server };

