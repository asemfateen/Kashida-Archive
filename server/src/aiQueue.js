import { GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import pool from "./db.js";
import { r2, R2_BUCKET, isR2Configured } from "./r2.js";
import { ai, GEMINI_MODEL, isGeminiConfigured } from "./gemini.js";
import { parseTags, mergeTags } from "./tagParser.js";

// How long a rate-limit sighting stays "fresh". After an hour without a new
// rate-limit error the queue considers itself clear and tries again, even if
// Gemini might still reject it (which would re-arm the clock).
const RATE_LIMIT_MEMORY_MS = 60 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 1500;
const DEFAULT_DAILY_LIMIT = 20;
const DEFAULT_MASTER_PROMPT = "Give me 5 descriptive keywords for this image.";
const MAX_ATTEMPTS = 3;
const DRAIN_INTERVAL_MS = 3000;
const MAX_COOLDOWN_MS = RATE_LIMIT_MEMORY_MS;

const VALID_STATUSES = ["queued", "running", "done", "failed", "canceled"];

let drainTimer = null;

async function getState(key, fallback) {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM ai_state WHERE key = $1",
      [key],
    );
    if (rows.length === 0) return fallback;
    return JSON.parse(rows[0].value);
  } catch {
    return fallback;
  }
}

async function setState(key, value) {
  await pool.query(
    `INSERT INTO ai_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function getConfig() {
  const cfg = await getState("config", {});
  return {
    master_prompt: DEFAULT_MASTER_PROMPT,
    min_interval_ms: DEFAULT_MIN_INTERVAL_MS,
    daily_limit: DEFAULT_DAILY_LIMIT,
    ...cfg,
  };
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await setState("config", next);
  return next;
}

export async function getPaused() {
  return (await getState("paused", false)) === true;
}

export async function setPaused(value) {
  await setState("paused", Boolean(value));
  return Boolean(value);
}

async function getQuota() {
  return await getState("quota", {});
}

// Current rate-limit status. The 1-hour freshness rule: a remembered pause
// only applies when a rate-limit error was observed within the last hour.
export async function getRateLimitStatus() {
  const quota = await getQuota();
  const usage = typeof quota.count === "number" ? quota.count : 0;
  if (!quota.rateLimitedAt) {
    return { rate_limited: false, until: null, reason: null, usage };
  }
  const seenAt = new Date(quota.rateLimitedAt).getTime();
  const fresh = Date.now() - seenAt < RATE_LIMIT_MEMORY_MS;
  if (!fresh) {
    return { rate_limited: false, until: null, reason: null, usage };
  }
  const until = quota.rateLimitedUntil
    ? new Date(quota.rateLimitedUntil).getTime()
    : 0;
  if (Date.now() < until) {
    return {
      rate_limited: true,
      until,
      reason: quota.lastError || "rate limited",
      usage,
    };
  }
  return { rate_limited: false, until: null, reason: null, usage };
}

async function recordRateLimit(error) {
  const raw = String(error?.message || "rate limited").slice(0, 500);
  const retryMatch = raw.match(/retry\s*(?:after|in)\s*([\d.]+)\s*s/i);
  let retryMs = 60_000;
  if (retryMatch) {
    const parsed = parseFloat(retryMatch[1]) * 1000;
    if (Number.isFinite(parsed)) {
      retryMs = Math.min(Math.max(Math.floor(parsed), 5_000), MAX_COOLDOWN_MS);
    }
  }
  const quota = await getQuota();
  await setState("quota", {
    ...quota,
    rateLimitedAt: new Date().toISOString(),
    retryAfterMs: retryMs,
    rateLimitedUntil: new Date(Date.now() + retryMs).toISOString(),
    lastError: raw,
  });
}

async function bumpUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const quota = await getQuota();
  if (quota.date === today) {
    await setState("quota", { ...quota, count: (quota.count || 0) + 1 });
  } else {
    await setState("quota", {
      date: today,
      count: 1,
      rateLimitedAt: quota.rateLimitedAt,
      retryAfterMs: quota.retryAfterMs,
      rateLimitedUntil: quota.rateLimitedUntil,
      lastError: quota.lastError,
    });
  }
}

async function loadImageData(objectKey) {
  const res = await r2.send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: objectKey }),
  );
  if (!res.Body) throw new Error("image body is empty");
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  const thumb = await sharp(Buffer.concat(chunks))
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { mime: "image/jpeg", data: thumb.toString("base64") };
}

function isRetryable(error) {
  const raw = String(error?.message || "");
  return (
    (error?.status && error.status >= 429) ||
    /busy|high demand|overloaded|rate|quota|unavailable/i.test(raw)
  );
}

async function processJob(job) {
  await pool.query(
    `UPDATE ai_jobs SET status = 'running', started_at = now(), attempts = attempts + 1 WHERE id = $1`,
    [job.id],
  );
  try {
    if (!isR2Configured()) {
      throw new Error("R2 is not configured on the server");
    }
    const { mime, data } = await loadImageData(job.object_key);
    const prompt = job.prompt || (await getConfig()).master_prompt;
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        { inlineData: { mimeType: mime, data } },
        `${prompt}\nRespond ONLY with a JSON array of strings, e.g. ["tag1","tag2"].`,
      ],
    });
    const tags = parseTags(response.text);
    if (!tags) {
      throw new Error("Gemini response was not a tag array");
    }
    await bumpUsage();
    const current = await pool.query(
      `SELECT tags FROM images WHERE object_key = $1 LIMIT 1`,
      [job.object_key],
    );
    if (current.rows.length === 0) {
      throw new Error("image not found");
    }
    const merged = mergeTags(current.rows[0].tags, tags);
    await pool.query(`UPDATE images SET tags = $1 WHERE object_key = $2`, [
      merged.join(" "),
      job.object_key,
    ]);
    await pool.query(
      `UPDATE ai_jobs SET status = 'done', result_tags = $1, error = '', finished_at = now() WHERE id = $2`,
      [tags.join(" "), job.id],
    );
  } catch (err) {
    const raw = String(err?.message || "AI tagging failed").slice(0, 500);
    console.error("AI tagging failed:", raw);
    if (isRetryable(err)) {
      await recordRateLimit(err);
      if (job.attempts >= MAX_ATTEMPTS) {
        await pool.query(
          `UPDATE ai_jobs SET status = 'failed', error = $1, finished_at = now() WHERE id = $2`,
          [raw, job.id],
        );
      } else {
        await pool.query(
          `UPDATE ai_jobs SET status = 'queued', error = $1 WHERE id = $2`,
          [raw, job.id],
        );
      }
    } else {
      await pool.query(
        `UPDATE ai_jobs SET status = 'failed', error = $1, finished_at = now() WHERE id = $2`,
        [raw, job.id],
      );
    }
  }
}

let lastCallAt = 0;
let processing = false;

async function drain() {
  if (processing) return;
  processing = true;
  try {
    if (await getPaused()) return;
    const { rate_limited } = await getRateLimitStatus();
    if (rate_limited) return;
    const cfg = await getConfig();
    const wait = lastCallAt + cfg.min_interval_ms - Date.now();
    if (wait > 0) return;
    const { rows } = await pool.query(
      `SELECT * FROM ai_jobs WHERE status = 'queued'
       ORDER BY priority DESC, created_at ASC LIMIT 1`,
    );
    if (rows.length === 0) return;
    lastCallAt = Date.now();
    await processJob(rows[0]);
  } catch (err) {
    // Transient DB hiccups are fine — the next tick retries.
    if (!/connection|ECONNREFUSED|pool/i.test(String(err?.message || ""))) {
      console.error("[aiQueue] drain error:", err.message);
    }
  } finally {
    processing = false;
  }
}

export function startQueue() {
  // Test suites opt out so a shared dev DB isn't drained by several workers
  // at once during `npm test`.
  if (process.env.AI_QUEUE === "false") return;
  if (drainTimer || !isGeminiConfigured()) return;
  drainTimer = setInterval(drain, DRAIN_INTERVAL_MS);
  drainTimer.unref();
  drain();
}

export async function getQueueCounts() {
  const counts = { queued: 0, running: 0, done: 0, failed: 0, canceled: 0 };
  try {
    const { rows } = await pool.query(
      `SELECT status, count(*)::int AS n FROM ai_jobs GROUP BY status`,
    );
    for (const row of rows)
      if (row.status in counts) counts[row.status] = row.n;
  } catch {
    // DB not ready yet — return zeroed counts.
  }
  return counts;
}

export { VALID_STATUSES, MAX_ATTEMPTS, RATE_LIMIT_MEMORY_MS };
