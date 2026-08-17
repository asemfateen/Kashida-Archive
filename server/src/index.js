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
import { GEMINI_MODEL, isGeminiConfigured } from "./gemini.js";
import { mergeTags } from "./tagParser.js";
import initDb from "./initDb.js";
import {
  getConfig,
  setConfig,
  getPaused,
  setPaused,
  getRateLimitStatus,
  getQueueCounts,
  startQueue,
  VALID_STATUSES,
} from "./aiQueue.js";
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
    if (dbReady) startQueue();
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
const RATE_LOGIN = makeRateLimit({ windowMs: 60_000, max: 10 });
const RATE_UPLOAD = makeRateLimit({ windowMs: 60_000, max: 600 });
const RATE_TAG = makeRateLimit({ windowMs: 60_000, max: 60 });
const RATE_AI_JOBS = makeRateLimit({ windowMs: 60_000, max: 300 });
// Tests reset these between cases to avoid cross-test leaks.
export { RATE_LOGIN, RATE_UPLOAD, RATE_TAG, RATE_AI_JOBS };
app.get("/api/health", async (req, res) => {
  await dbInit;
  res.json({ ok: true, service: "kashida-archive", db: dbReady });
});

app.post("/api/auth/login", RATE_LOGIN, async (req, res) => {
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

// Batch tag: merge tags server-side, per row, inside a single transaction.
// Row locks serialize against the AI queue's concurrent writes so the merge
// never clobbers tags the queue just saved, and one request replaces N
// per-image PATCH round trips from the client.
app.post("/api/images/batch-tag", async (req, res) => {
  const { objectKeys, tags } = req.body || {};
  if (!validateKeyList(objectKeys)) {
    return res
      .status(400)
      .json({ error: "objectKeys must be a non-empty list" });
  }
  const incoming = Array.isArray(tags)
    ? tags.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean)
    : [];
  if (incoming.length === 0) {
    return res.status(400).json({ error: "tags must be a non-empty list" });
  }
  const joined = incoming.join(" ");
  if (joined.length > 2000 || joined.includes("\0")) {
    return res.status(400).json({ error: "invalid tags" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT object_key, tags FROM images WHERE object_key = ANY($1) FOR UPDATE`,
      [objectKeys],
    );
    for (const row of rows) {
      const merged = mergeTags(row.tags, incoming);
      await client.query(`UPDATE images SET tags = $1 WHERE object_key = $2`, [
        merged.join(" "),
        row.object_key,
      ]);
    }
    await client.query("COMMIT");
    res.json({ updated: rows.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Batch tag failed:", err.message);
    res.status(500).json({ error: "failed to tag images" });
  } finally {
    client.release();
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

// q may arrive as a string or an array (repeatable query params).
function parseStringList(v) {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => String(x).trim()).filter(Boolean);
}

// Shared WHERE builder for /api/search and /api/facets so facet counts always
// annotate the exact result set they describe (no dead-end links). Keyword
// matching is full-text OR fuzzy-trigram; facet filters (exact tags, type,
// date range) AND on top of it, mirroring clicking facets in the Matrix.
function buildSearchContext(req) {
  const q = String(req.query.q ?? "").trim();
  const sort = req.query.sort || "rank";
  const orderBy =
    sort === "newest"
      ? "created_at DESC"
      : sort === "oldest"
        ? "created_at ASC"
        : "rank DESC, created_at DESC";

  const clauses = [];
  const params = [];

  if (q) {
    params.push(buildTsQuery(q), q, `%${q}%`);
    const base = params.length - 3;
    clauses.push(
      `(search_vector @@ to_tsquery('simple', $${base + 1}) OR tags ILIKE $${base + 3} OR word_similarity(tags, $${base + 2}) >= 0.25)`,
    );
  }

  for (const tag of parseStringList(req.query.tag)) {
    params.push(tag);
    clauses.push(`string_to_array(tags, ' ') @> ARRAY[$${params.length}]`);
  }

  const type = String(req.query.type ?? "").trim();
  if (type === "jpg") {
    clauses.push(`(object_key ILIKE '%.jpg' OR object_key ILIKE '%.jpeg')`);
  } else if (type === "png") {
    clauses.push(`object_key ILIKE '%.png'`);
  } else if (type === "raw") {
    clauses.push(
      `NOT (object_key ILIKE '%.jpg' OR object_key ILIKE '%.jpeg' OR object_key ILIKE '%.png')`,
    );
  }

  const dateFrom = String(req.query.dateFrom ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(dateFrom)) {
    params.push(dateFrom);
    clauses.push(`created_at >= $${params.length}::timestamptz`);
  }
  const dateTo = String(req.query.dateTo ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(dateTo)) {
    params.push(dateTo);
    clauses.push(
      `created_at < ($${params.length}::timestamptz + interval '1 day')`,
    );
  }

  clauses.push("deleted = false");
  return { q, orderBy, whereSql: clauses.join(" AND "), params };
}

// Managed DBs without CREATE EXTENSION rights can't use the trigram operators;
// strip the fuzzy clause and fall back to plain full-text.
function withoutTrigram(sql) {
  return sql.replace(/ OR word_similarity\([^)]*\) >= 0\.25/g, "");
}

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    return res.status(400).json({ error: "q query parameter is required" });
  }

  const ctx = buildSearchContext(req);
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

  // Composite rank: full-text rank and trigram word_similarity both feed the
  // ordering. ts_rank() returns float4; word_similarity() float8, so cast the
  // ts_rank to keep GREATEST() type-safe. similarity() is kept as a second
  // trigram signal for short/case-insensitive tag hunks.
  const RANK_SQL = `GREATEST(
    ts_rank(search_vector, to_tsquery('simple', $1))::float8,
    word_similarity(tags, $2),
    similarity(tags, $2)
  ) AS rank`;

  const rowsOf = (result) =>
    result.rows.map((row) => ({
      ...row,
      url: publicUrl(publicBase, row.object_key),
      thumb: thumbUrl(row.object_key),
    }));

  try {
    const result = await pool.query(
      `SELECT id, object_key, original_filename, tags, favorite, created_at,
              ${RANK_SQL}
       FROM images
       WHERE ${ctx.whereSql}
       ORDER BY ${ctx.orderBy}
       LIMIT ${SEARCH_LIMIT}`,
      ctx.params,
    );
    res.json(rowsOf(result));
  } catch (err) {
    // If pg_trgm isn't available (e.g. a managed DB without CREATE EXTENSION
    // rights) fall back to the previous full-text query so search still works.
    if (err?.code === "42883" || /pg_trgm|operator.*\?/i.test(err.message)) {
      try {
        const result = await pool.query(
          `SELECT id, object_key, original_filename, tags, favorite, created_at,
                  ts_rank(search_vector, to_tsquery('simple', $1)) AS rank
           FROM images
           WHERE ${withoutTrigram(ctx.whereSql)}
           ORDER BY ${ctx.orderBy}
           LIMIT ${SEARCH_LIMIT}`,
          ctx.params,
        );
        return res.json(rowsOf(result));
      } catch (fallbackErr) {
        console.error("Search fallback failed:", fallbackErr.message);
        return res.status(500).json({ error: "search failed" });
      }
    }
    console.error("Search failed:", err.message);
    res.status(500).json({ error: "search failed" });
  }
});

// The Matrix: per-facet value counts (query previews) computed over the same
// WHERE as /api/search, so a value is only ever shown when selecting it
// returns results. Works with no q too, annotating the whole library.
app.get("/api/facets", async (req, res) => {
  const ctx = buildSearchContext(req);

  const queryFacets = async (where) =>
    Promise.all([
      pool.query(
        `SELECT tag, count(*)::int AS n
         FROM images
         CROSS JOIN LATERAL unnest(string_to_array(tags, ' ')) AS t(tag)
         WHERE ${where} AND tag <> ''
         GROUP BY tag ORDER BY n DESC, tag ASC LIMIT 30`,
        ctx.params,
      ),
      pool.query(
        `SELECT CASE
                  WHEN object_key ILIKE '%.jpg' OR object_key ILIKE '%.jpeg' THEN 'jpg'
                  WHEN object_key ILIKE '%.png' THEN 'png'
                  ELSE 'raw'
                END AS type,
                count(*)::int AS n
         FROM images
         WHERE ${where}
         GROUP BY type ORDER BY n DESC`,
        ctx.params,
      ),
      pool.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                count(*)::int AS n
         FROM images
         WHERE ${where}
         GROUP BY 1 ORDER BY 1 DESC LIMIT 14`,
        ctx.params,
      ),
    ]);

  try {
    const [tags, types, days] = await queryFacets(ctx.whereSql);
    res.json({ tags: tags.rows, types: types.rows, days: days.rows });
  } catch (err) {
    if (err?.code === "42883" || /pg_trgm|operator.*\?/i.test(err.message)) {
      try {
        const [tags, types, days] = await queryFacets(
          withoutTrigram(ctx.whereSql),
        );
        return res.json({
          tags: tags.rows,
          types: types.rows,
          days: days.rows,
        });
      } catch (fallbackErr) {
        console.error("Facets fallback failed:", fallbackErr.message);
        return res.status(500).json({ error: "facets failed" });
      }
    }
    console.error("Facets failed:", err.message);
    res.status(500).json({ error: "facets failed" });
  }
});

// Keyword disambiguation: tags that start with the typed key, with counts, so
// the user can swap the free-text term for a real metadata term.
app.get("/api/tags/suggest", async (req, res) => {
  const q = String(req.query.q ?? "")
    .trim()
    .toLowerCase();
  if (!q) return res.json([]);
  const safe = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  try {
    const { rows } = await pool.query(
      `SELECT tag, count(*)::int AS n
       FROM images
       CROSS JOIN LATERAL unnest(string_to_array(lower(tags), ' ')) AS t(tag)
       WHERE deleted = false AND tag LIKE $1
       GROUP BY tag ORDER BY n DESC, tag ASC LIMIT 10`,
      [`${safe}%`],
    );
    res.json(rows);
  } catch (err) {
    console.error("Tag suggest failed:", err.message);
    res.status(500).json({ error: "tag suggest failed" });
  }
});

// Exact tag counts across the live (non-deleted) library. Endgame contextual
// links show how many photos each tag leads to — like the Matrix, no dead-ends.
app.get("/api/tags/count", async (req, res) => {
  const tags = parseStringList(req.query.tag);
  if (tags.length === 0) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT tag, count(*)::int AS n
       FROM images
       CROSS JOIN LATERAL unnest(string_to_array(tags, ' ')) AS t(tag)
       WHERE deleted = false AND tag = ANY($1::text[])
       GROUP BY tag ORDER BY tag ASC`,
      [tags],
    );
    res.json(rows);
  } catch (err) {
    console.error("Tag count failed:", err.message);
    res.status(500).json({ error: "tag count failed" });
  }
});

// AI tagging now goes through the persistent queue (see aiQueue.js): enqueue a
// single job and let the background worker pace it against Gemini's quota.
// This endpoint stays for compatibility with the legacy per-image flow.
app.post("/api/images/tag", RATE_TAG, async (req, res) => {
  const { objectKey, prompt } = req.body || {};

  if (!objectKey || typeof objectKey !== "string" || objectKey.includes("\0")) {
    return res.status(400).json({ error: "objectKey is required" });
  }
  if (!isGeminiConfigured()) {
    return res
      .status(500)
      .json({ error: "Gemini is not configured on the server" });
  }
  let p = null;
  if (prompt !== undefined) {
    if (typeof prompt !== "string" || prompt.length > 2000) {
      return res.status(400).json({ error: "invalid prompt" });
    }
    p = prompt.trim() || null;
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ai_jobs (object_key, prompt) VALUES ($1, $2)
       RETURNING id, object_key, prompt, status, created_at`,
      [objectKey, p],
    );
    res.status(201).json({ queued: true, jobId: rows[0].id, job: rows[0] });
  } catch (err) {
    console.error("Enqueue tag failed:", err.message);
    res.status(500).json({ error: "failed to queue AI tagging" });
  }
});

// ---------------------------------------------------------------------------
// AI control plane — status, queue management and config. Everything here is
// JWT-guarded by the shared /api auth middleware.
// ---------------------------------------------------------------------------

app.get("/api/ai/status", async (_req, res) => {
  try {
    const [config, paused, rateLimit, queue] = await Promise.all([
      getConfig(),
      getPaused(),
      getRateLimitStatus(),
      getQueueCounts(),
    ]);
    res.json({
      configured: isGeminiConfigured(),
      model: GEMINI_MODEL,
      paused,
      config,
      quota: {
        usage: rateLimit.usage,
        daily_limit: config.daily_limit,
        rate_limited: rateLimit.rate_limited,
        rate_limited_until: rateLimit.until
          ? new Date(rateLimit.until).toISOString()
          : null,
        last_error: rateLimit.reason,
      },
      queue,
    });
  } catch (err) {
    console.error("AI status failed:", err.message);
    res.status(500).json({ error: "failed to read AI status" });
  }
});

app.get("/api/ai/jobs", async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(
    Math.max(Number.parseInt(req.query.limit, 10) || 100, 1),
    500,
  );
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const params = [];
  let where = "";
  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "invalid status filter" });
    }
    params.push(status);
    where = "WHERE j.status = $1";
  }
  params.push(limit, offset);
  try {
    const { rows } = await pool.query(
      `SELECT j.id, j.object_key, j.prompt, j.status, j.attempts, j.result_tags,
              j.error, j.created_at, j.started_at, j.finished_at,
              i.original_filename
       FROM ai_jobs j
       LEFT JOIN images i ON i.object_key = j.object_key
       ${where}
       ORDER BY j.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json(
      rows.map((row) => ({
        ...row,
        thumb: thumbUrl(row.object_key),
      })),
    );
  } catch (err) {
    console.error("List AI jobs failed:", err.message);
    res.status(500).json({ error: "failed to list AI jobs" });
  }
});

app.post("/api/ai/jobs", RATE_AI_JOBS, async (req, res) => {
  const { objectKeys, prompt } = req.body || {};
  if (!validateKeyList(objectKeys)) {
    return res
      .status(400)
      .json({ error: "objectKeys must be a non-empty list" });
  }
  let p = null;
  if (prompt !== undefined) {
    if (typeof prompt !== "string" || prompt.length > 2000) {
      return res.status(400).json({ error: "invalid prompt" });
    }
    p = prompt.trim() || null;
  }
  try {
    const unique = [...new Set(objectKeys)];
    // Don't double-queue keys that are already waiting or running.
    const { rows } = await pool.query(
      `SELECT object_key FROM ai_jobs
       WHERE object_key = ANY($1) AND status IN ('queued', 'running')`,
      [unique],
    );
    const active = new Set(rows.map((r) => r.object_key));
    const toInsert = unique.filter((k) => !active.has(k));
    if (toInsert.length === 0) {
      return res.json({ enqueued: 0, skipped: active.size, jobs: [] });
    }
    const values = [];
    const tuples = toInsert
      .map((k) => {
        values.push(k, p);
        return `($${values.length - 1}, $${values.length})`;
      })
      .join(", ");
    const inserted = await pool.query(
      `INSERT INTO ai_jobs (object_key, prompt) VALUES ${tuples}
       RETURNING id, object_key, prompt, status, created_at`,
      values,
    );
    res.status(201).json({
      enqueued: inserted.rows.length,
      skipped: active.size,
      jobs: inserted.rows,
    });
  } catch (err) {
    console.error("Enqueue AI jobs failed:", err.message);
    res.status(500).json({ error: "failed to queue AI tagging" });
  }
});

app.patch("/api/ai/jobs/:id", async (req, res) => {
  const { id } = req.params;
  const { status, prompt } = req.body || {};
  if (status === "canceled") {
    try {
      const check = await pool.query(
        `SELECT status FROM ai_jobs WHERE id = $1`,
        [id],
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ error: "job not found" });
      }
      if (
        check.rows[0].status !== "queued" &&
        check.rows[0].status !== "running"
      ) {
        return res
          .status(400)
          .json({ error: "only queued or running jobs can be canceled" });
      }
    } catch (err) {
      console.error("Cancel check failed:", err.message);
      return res.status(500).json({ error: "failed to check job status" });
    }
  }
  const sets = [];
  const values = [];
  if (status !== undefined) {
    if (status !== "queued" && status !== "canceled") {
      return res
        .status(400)
        .json({ error: "status must be queued or canceled" });
    }
    values.push(status);
    sets.push(`status = $${values.length}`);
    if (status === "canceled") sets.push("finished_at = now()");
  }
  if (prompt !== undefined) {
    if (typeof prompt !== "string" || prompt.length > 2000) {
      return res.status(400).json({ error: "invalid prompt" });
    }
    values.push(prompt.trim() || null);
    sets.push(`prompt = $${values.length}`);
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: "nothing to update" });
  }
  values.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE ai_jobs SET ${sets.join(", ")} WHERE id = $${values.length}
       RETURNING id, object_key, prompt, status, attempts, result_tags, error,
                 created_at, started_at, finished_at`,
      values,
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "job not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Update AI job failed:", err.message);
    res.status(500).json({ error: "failed to update job" });
  }
});

app.post("/api/ai/jobs/:id/retry", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE ai_jobs
       SET status = 'queued', attempts = 0, error = '', finished_at = NULL
       WHERE id = $1 AND status IN ('failed', 'canceled')
       RETURNING id, object_key, prompt, status, attempts, result_tags, error, created_at`,
      [req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "job not found or not retryable" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Retry AI job failed:", err.message);
    res.status(500).json({ error: "failed to retry job" });
  }
});

app.post("/api/ai/jobs/retry-failed", async (_req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE ai_jobs
       SET status = 'queued', attempts = 0, error = '', finished_at = NULL
       WHERE status = 'failed'`,
    );
    res.json({ requeued: rowCount });
  } catch (err) {
    console.error("Retry failed jobs failed:", err.message);
    res.status(500).json({ error: "failed to retry failed jobs" });
  }
});

app.post("/api/ai/jobs/cancel-all", async (_req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE ai_jobs SET status = 'canceled', finished_at = now()
       WHERE status = 'queued'`,
    );
    res.json({ canceled: rowCount });
  } catch (err) {
    console.error("Cancel all failed:", err.message);
    res.status(500).json({ error: "failed to cancel jobs" });
  }
});

app.delete("/api/ai/jobs/clear-done", async (_req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ai_jobs WHERE status IN ('done', 'failed', 'canceled')`,
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error("Clear done jobs failed:", err.message);
    res.status(500).json({ error: "failed to clear finished jobs" });
  }
});

app.delete("/api/ai/jobs/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ai_jobs WHERE id = $1 AND status IN ('done', 'failed', 'canceled')`,
      [req.params.id],
    );
    if (rowCount === 0) {
      return res
        .status(400)
        .json({ error: "only finished jobs can be deleted" });
    }
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error("Delete AI job failed:", err.message);
    res.status(500).json({ error: "failed to delete job" });
  }
});

app.get("/api/ai/config", async (_req, res) => {
  try {
    const [config, paused] = await Promise.all([getConfig(), getPaused()]);
    res.json({ config, paused });
  } catch (err) {
    console.error("Get AI config failed:", err.message);
    res.status(500).json({ error: "failed to read AI config" });
  }
});

app.patch("/api/ai/config", async (req, res) => {
  const { master_prompt, min_interval_ms, daily_limit, paused } =
    req.body || {};
  const patch = {};
  if (master_prompt !== undefined) {
    if (typeof master_prompt !== "string" || master_prompt.length > 2000) {
      return res.status(400).json({ error: "invalid master_prompt" });
    }
    patch.master_prompt =
      master_prompt.trim() || "Give me 5 descriptive keywords for this image.";
  }
  if (min_interval_ms !== undefined) {
    const n = Number(min_interval_ms);
    if (!Number.isFinite(n) || n < 0 || n > 600_000) {
      return res.status(400).json({ error: "invalid min_interval_ms" });
    }
    patch.min_interval_ms = Math.floor(n);
  }
  if (daily_limit !== undefined) {
    const n = Number(daily_limit);
    if (!Number.isFinite(n) || n < 1 || n > 100_000) {
      return res.status(400).json({ error: "invalid daily_limit" });
    }
    patch.daily_limit = Math.floor(n);
  }
  try {
    if (paused !== undefined) await setPaused(Boolean(paused));
    const config = await setConfig(patch);
    res.json({ config, paused: await getPaused() });
  } catch (err) {
    console.error("Update AI config failed:", err.message);
    res.status(500).json({ error: "failed to update AI config" });
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
