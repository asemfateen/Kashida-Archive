import "./env.js";
import express from "express";
import cors from "cors";
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { r2, R2_BUCKET, isR2Configured } from "./r2.js";
import pool from "./db.js";
import { ai, GEMINI_MODEL, isGeminiConfigured } from "./gemini.js";
import { parseTags, mergeTags } from "./tagParser.js";
import initDb from "./initDb.js";
import {
  ADMIN_USER,
  isAuthConfigured,
  checkCredentials,
  signToken,
  requireAuth,
} from "./auth.js";

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
  const limiter = (req, res, next) => {
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
  // Tests reset limiter state between cases so they don't leak into each other.
  limiter.reset = () => hits.clear();
  return limiter;
}
const RATE_UPLOAD = makeRateLimit({ windowMs: 60_000, max: 600 });
const RATE_TAG = makeRateLimit({ windowMs: 60_000, max: 60 });
// Tests reset these between cases to avoid cross-test leaks.
export { RATE_UPLOAD, RATE_TAG };
app.get("/api/health", async (req, res) => {
  await dbInit;
  res.json({ ok: true, service: "kashida-archive", db: dbReady });
});

app.post("/api/auth/login", async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(500).json({
      error:
        "auth is not configured — set ADMIN_USER, ADMIN_PASS and JWT_SECRET in production",
    });
  }
  const { username, password } = req.body || {};
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ error: "invalid username or password" });
  }
  res.json({ token: signToken(username), user: { username: ADMIN_USER } });
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

// Everything under /api is authenticated except health, login and the raw
// image serve endpoint (images load in <img> tags which can't carry headers).
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/auth/login") return next();
  if (
    req.path === "/images/serve" ||
    req.path.startsWith("/images/serve/") ||
    req.path.startsWith("/images/thumb/")
  )
    return next();
  return requireAuth(req, res, next);
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
       RETURNING id, object_key, original_filename, tags, favorite, deleted, created_at`,
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
  if (
    !publicBase ||
    publicBase.includes("example.com") ||
    publicBase.includes("r2.cloudflarestorage.com")
  ) {
    return `/api/images/serve/${encoded}`;
  }
  return `${publicBase}/${encoded}`;
}

function thumbUrl(objectKey) {
  const encoded = objectKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/api/images/thumb/${encoded}`;
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
      rows.map((row) => ({
        ...row,
        url: publicUrl(publicBase, row.object_key),
        thumb: thumbUrl(row.object_key),
      })),
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
    // Object keys are unique UUIDs, so the bytes never change for a given URL:
    // cache aggressively so re-visiting the library does not re-stream every
    // image from R2 through this server.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.Body.pipe(res);
  } catch (err) {
    console.error("Serve image failed:", err.message);
    res.status(404).send("Not Found");
  }
});

const THUMB_WIDTH = 420;
const THUMB_QUALITY = 75;
// Keyed by objectKey, dedupes concurrent requests for the same thumbnail so a
// 200-photo grid doesn't resize the same file 200 times at once.
const thumbJobs = new Map();

function thumbObjectKey(objectKey) {
  return `thumbs/${createHash("sha1").update(objectKey).digest("hex")}.webp`;
}

app.get("/api/images/thumb/*", async (req, res) => {
  const objectKey = req.params[0];
  if (!objectKey || objectKey.includes("\0")) {
    return res.status(400).json({ error: "invalid objectKey" });
  }
  if (!isR2Configured()) {
    return res.status(503).json({ error: "R2 is not configured" });
  }
  const thumbKey = thumbObjectKey(objectKey);
  try {
    const cached = await r2.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: thumbKey }),
    );
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return cached.Body.pipe(res);
  } catch {
    // Thumbnail not generated yet — fall through and build it.
  }

  if (thumbJobs.has(objectKey)) {
    return thumbJobs.get(objectKey).then(
      (buf) => {
        res.setHeader("Content-Type", "image/webp");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.send(buf);
      },
      () => res.status(404).send("Not Found"),
    );
  }

  const job = (async () => {
    try {
      const full = await r2.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: objectKey }),
      );
      if (!full.Body) throw new Error("empty body");
      const chunks = [];
      for await (const chunk of full.Body) chunks.push(chunk);
      const thumb = await sharp(Buffer.concat(chunks))
        .rotate()
        .resize(THUMB_WIDTH, THUMB_WIDTH, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();
      try {
        await r2.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: thumbKey,
            Body: thumb,
            ContentType: "image/webp",
          }),
        );
      } catch (putErr) {
        console.error("Thumb store failed:", putErr.message);
      }
      return thumb;
    } finally {
      thumbJobs.delete(objectKey);
    }
  })();
  thumbJobs.set(objectKey, job);
  try {
    const thumb = await job;
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(thumb);
  } catch (err) {
    console.error("Thumbnail generation failed:", err.message);
    res.status(404).send("Not Found");
  }
});

function validateKeyList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    return false;
  }
  return value.every(
    (k) =>
      typeof k === "string" &&
      k.length > 0 &&
      k.length <= 512 &&
      !k.includes("\0"),
  );
}

// Batch update for multi-select actions (trash/restore/favorite). Mirrors the
// single-image PATCH but over an object_key set.
app.post("/api/images/batch", async (req, res) => {
  const { objectKeys, patch } = req.body || {};
  if (!validateKeyList(objectKeys)) {
    return res
      .status(400)
      .json({ error: "objectKeys must be a non-empty list" });
  }
  const { tags, favorite, deleted } = patch || {};
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
  values.push(objectKeys);
  try {
    const { rows } = await pool.query(
      `UPDATE images SET ${sets.join(", ")} WHERE object_key = ANY($${values.length})
       RETURNING id, object_key, original_filename, tags, favorite, deleted, created_at`,
      values,
    );
    res.json({ updated: rows.length });
  } catch (err) {
    console.error("Batch update failed:", err.message);
    res.status(500).json({ error: "failed to update images" });
  }
});

// Hard-delete a set of images (from trash): removes DB rows and their R2
// objects. R2 cleanup is best-effort so a partial failure never strands rows.
app.post("/api/images/batch-delete", async (req, res) => {
  const { objectKeys } = req.body || {};
  if (!validateKeyList(objectKeys)) {
    return res
      .status(400)
      .json({ error: "objectKeys must be a non-empty list" });
  }
  try {
    const { rows } = await pool.query(
      `DELETE FROM images WHERE object_key = ANY($1) RETURNING object_key`,
      [objectKeys],
    );
    if (isR2Configured()) {
      for (const row of rows) {
        try {
          await r2.send(
            new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: row.object_key }),
          );
        } catch (r2Err) {
          console.error(
            "R2 object delete failed:",
            row.object_key,
            r2Err.message,
          );
        }
      }
    }
    res.json({ deleted: rows.length });
  } catch (err) {
    console.error("Batch delete failed:", err.message);
    res.status(500).json({ error: "failed to delete images" });
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
    const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(
      /\/+$/,
      "",
    );
    res.json({
      ...rows[0],
      url: publicUrl(publicBase, rows[0].object_key),
      thumb: thumbUrl(rows[0].object_key),
    });
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
  if (req.query.permanent === "true") {
    try {
      const { rows } = await pool.query(
        `DELETE FROM images WHERE object_key = $1 RETURNING object_key`,
        [objectKey],
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "image not found" });
      }
      if (isR2Configured()) {
        try {
          await r2.send(
            new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: objectKey }),
          );
        } catch (r2Err) {
          console.error(
            "R2 object delete failed (row already removed):",
            r2Err.message,
          );
        }
      }
      return res.json({ deleted: true, permanent: true });
    } catch (err) {
      console.error("Permanent delete failed:", err.message);
      return res.status(500).json({ error: "failed to delete image" });
    }
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

app.delete("/api/trash", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM images WHERE deleted = true RETURNING object_key`,
    );
    if (isR2Configured()) {
      for (const row of rows) {
        try {
          await r2.send(
            new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: row.object_key }),
          );
        } catch (r2Err) {
          console.error(
            "R2 object delete failed:",
            row.object_key,
            r2Err.message,
          );
        }
      }
    }
    res.json({ deleted: rows.length });
  } catch (err) {
    console.error("Empty trash failed:", err.message);
    res.status(500).json({ error: "failed to empty trash" });
  }
});

function buildTsQuery(raw) {
  const terms = (
    String(raw)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  )
    .filter((t) => t.length > 0)
    .slice(0, 50);
  if (terms.length === 0) return null;
  return terms.map((t) => `${t}:*`).join(" | ");
}

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    return res.status(400).json({ error: "q query parameter is required" });
  }

  const terms = buildTsQuery(q);
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const sort = req.query.sort || "rank";
  const orderBy =
    sort === "newest"
      ? "created_at DESC"
      : sort === "oldest"
        ? "created_at ASC"
        : "rank DESC, created_at DESC";

  // Composite rank: full-text rank and trigram word_similarity both feed the
  // ordering. ts_rank() returns float4; word_similarity() float8, so cast the
  // ts_rank to keep GREATEST() type-safe. similarity() is kept as a second
  // trigram signal for short/case-insensitive tag hunks.
  const RANK_SQL = `GREATEST(
    ts_rank(search_vector, to_tsquery('simple', $1))::float8,
    word_similarity(tags, $2),
    similarity(tags, $2)
  ) AS rank`;
  // Fuzzy path: match when a tag is word-similar to the query with a relaxed
  // 0.25 threshold (default is 0.3, which misses 1-char typos like
  // "protestt" → "protest" at 0.29). Unrelated terms score ~0, so the floor
  // still keeps noise out.
  const WHERE_SQL = `(search_vector @@ to_tsquery('simple', $1) OR tags ILIKE $3 OR word_similarity(tags, $2) >= 0.25)
    AND deleted = false`;

  try {
    const result = await pool.query(
      `SELECT id, object_key, original_filename, tags, favorite, created_at,
              ${RANK_SQL}
       FROM images
       WHERE ${WHERE_SQL}
       ORDER BY ${orderBy}
       LIMIT ${SEARCH_LIMIT}`,
      [terms, q, `%${q}%`],
    );

    res.json(
      result.rows.map((row) => ({
        ...row,
        url: publicUrl(publicBase, row.object_key),
        thumb: thumbUrl(row.object_key),
      })),
    );
  } catch (err) {
    // If pg_trgm isn't available (e.g. a managed DB without CREATE EXTENSION
    // rights) fall back to the previous full-text query so search still works.
    if (err?.code === "42883" || /pg_trgm|operator.*\?/i.test(err.message)) {
      try {
        const result = await pool.query(
          `SELECT id, object_key, original_filename, tags, favorite, created_at,
                  ts_rank(search_vector, to_tsquery('simple', $1)) AS rank
           FROM images
           WHERE (search_vector @@ to_tsquery('simple', $1) OR tags ILIKE $2)
             AND deleted = false
           ORDER BY ${orderBy}
           LIMIT ${SEARCH_LIMIT}`,
          [terms, `%${q}%`],
        );
        return res.json(
          result.rows.map((row) => ({
            ...row,
            url: publicUrl(publicBase, row.object_key),
            thumb: thumbUrl(row.object_key),
          })),
        );
      } catch (fallbackErr) {
        console.error("Search fallback failed:", fallbackErr.message);
        return res.status(500).json({ error: "search failed" });
      }
    }
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
    return {
      ok: false,
      error: "imageUrl requires R2_PUBLIC_BASE_URL to be configured",
    };
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
    return {
      ok: false,
      error: "imageUrl must be hosted by the configured storage origin",
    };
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
      if (total > MAX_TAG_IMAGE_BYTES)
        throw new Error("image reference too large");
      chunks.push(value);
    }
    return { mime: type, data: Buffer.concat(chunks).toString("base64") };
  }
  const buf = Buffer.from(await imageRes.arrayBuffer());
  if (buf.byteLength > MAX_TAG_IMAGE_BYTES)
    throw new Error("image reference too large");
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

    // Merge — never overwrite: keep existing tags, append the new AI tags,
    // and dedupe case-insensitively so the stored set stays clean.
    const current = await pool.query(
      `SELECT tags FROM images WHERE object_key = $1 LIMIT 1`,
      [objectKey],
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }
    const merged = mergeTags(current.rows[0].tags, tags);

    const { rows } = await pool.query(
      `UPDATE images SET tags = $1 WHERE object_key = $2
       RETURNING id, object_key, original_filename, tags, created_at`,
      [merged.join(" "), objectKey],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }

    res.json({ objectKey, tags, image: rows[0] });
  } catch (err) {
    console.error("AI tagging failed:", err.message);
    const raw = String(err?.message || "AI tagging failed");
    const status =
      err?.status && Number.isInteger(err.status) && err.status >= 400
        ? err.status
        : 500;
    res.status(status).json({
      error: raw.slice(0, 300) || "AI tagging failed",
      retryable: status >= 429 || /busy|high demand|overloaded|rate/i.test(raw),
    });
  }
});

const CLIENT_DIST = fileURLToPath(
  new URL("../../client/dist/", import.meta.url),
);
const SETUP_HTML = `<!doctype html><html><body style="font-family:system-ui;background:#0b0f19;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
  <div style="max-width:560px;text-align:center"><h1>Kashida Archive</h1>
  <p>Database is not ready.</p>
  <p style="color:#94a3b8;font-size:14px">DATABASE_URL is not configured. Kashida Archive detected the issue and is attempting to connect. Please check the service logs for details.</p>
  <p style="color:#94a3b8;font-size:13px">If you deployed a Postgres database, ensure the DATABASE_URL variable is set to the connection string and redeploy.</p></div></body></html>`;
if (isProduction && existsSync(CLIENT_DIST)) {
  // Degraded-mode guard first: without a ready DB the SPA can't function, so
  // non-API requests get the setup page (503) instead of a working-looking
  // shell from the static middleware below.
  app.use((req, res, next) => {
    if (dbReady || req.path.startsWith("/api")) return next();
    res.status(503).type("html").send(SETUP_HTML);
  });
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api(?:\/|$)).*/i, (_req, res) => {
    res.sendFile(`${CLIENT_DIST}/index.html`);
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
