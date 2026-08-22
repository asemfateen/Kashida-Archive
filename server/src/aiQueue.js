import { GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import pool from "./db.js";
import { r2, R2_BUCKET, isR2Configured } from "./r2.js";
import { ai, GEMINI_MODEL, isGeminiConfigured } from "./gemini.js";
import { parseTags, mergeTags } from "./tagParser.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Gemini free-tier daily quota — generous ceiling. The queue paces itself
// well below this via per-request intervals, but hitting it is a hard stop.
const DEFAULT_DAILY_LIMIT = 50;

// Minimum gap between successful Gemini calls (ms). Prevents burst spam
// even when the queue has dozens of jobs.
const DEFAULT_MIN_INTERVAL_MS = 4_000;

// Starting cooldown after a rate-limit error. Doubles on each consecutive
// failure, capped at MAX_COOLDOWN_MS. Reset to BASE on any success.
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 15 * 60_000; // 15 minutes



// How long a rate-limit observation stays "fresh". After an hour with no new
// errors the cooldown is cleared — even if Gemini might still reject
// (which would re-arm the clock). Keeps the system from being permanently
// stuck after a transient spike.
const RATE_LIMIT_MEMORY_MS = 60 * 60 * 1000;

const GEMINI_TIMEOUT_MS = 30_000;

const VALID_STATUSES = ["queued", "running", "done", "failed", "canceled"];
const MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// State helpers (ai_state KV table)
// ---------------------------------------------------------------------------

let drainTimer = null;
let activeTimeout = null;

async function getState(key, fallback) {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM ai_state WHERE key = $1",
      [key],
    );
    if (rows.length === 0) return fallback;
    const value = rows[0].value;
    return typeof value === "string" ? JSON.parse(value) : value;
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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getConfig() {
  const cfg = await getState("config", {});
  return {
    master_prompt: "Give me 5 descriptive keywords for this image.",
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

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

export async function getPaused() {
  return (await getState("paused", false)) === true;
}

export async function setPaused(value) {
  await setState("paused", Boolean(value));
  return Boolean(value);
}

// ---------------------------------------------------------------------------
// Rate-limit / quota tracking
//
// Separate keys: "quota" for daily usage + cooldown, "cooldown" for the
// backoff state. This avoids the old bug where bumpUsage() would overwrite
// cooldown fields.
// ---------------------------------------------------------------------------

async function getQuota() {
  return await getState("quota", {});
}

async function getCooldown() {
  return await getState("cooldown", {
    consecutiveFailures: 0,
    cooldownUntil: null,
    rateLimitedAt: null,
  });
}

export async function getRateLimitStatus() {
  const cfg = await getConfig();
  const quota = await getQuota();
  const cd = await getCooldown();
  const usage = typeof quota.count === "number" ? quota.count : 0;
  const today = new Date().toISOString().slice(0, 10);

  // Hard stop: daily cap.
  if (quota.date === today && usage >= cfg.daily_limit) {
    return {
      rate_limited: true,
      until: new Date(`${today}T23:59:59.999Z`).getTime(),
      reason: "daily quota reached",
      usage,
    };
  }

  // Cooldown from backoff.
  if (cd.cooldownUntil) {
    const until = new Date(cd.cooldownUntil).getTime();
    if (Date.now() < until) {
      return {
        rate_limited: true,
        until,
        reason: cd.lastError || "rate limited",
        usage,
      };
    }
    // Cooldown expired. If the observation is still fresh (< 1 hour),
    // do NOT immediately retry — use a reduced cooldown to space things out.
    if (cd.rateLimitedAt) {
      const observedAt = new Date(cd.rateLimitedAt).getTime();
      const fresh = Date.now() - observedAt < RATE_LIMIT_MEMORY_MS;
      if (fresh) {
        return {
          rate_limited: true,
          until: Date.now() + 60_000, // 1 minute grace
          reason: "cooling down after rate limit",
          usage,
        };
      }
    }
  }

  return { rate_limited: false, until: null, reason: null, usage };
}

async function recordRateLimit(error) {
  const raw = String(error?.message || "rate limited").slice(0, 500);

  const cd = await getCooldown();
  const consecutive = (cd.consecutiveFailures || 0) + 1;
  const backoff = Math.min(
    BASE_COOLDOWN_MS * 2 ** (consecutive - 1),
    MAX_COOLDOWN_MS,
  );

  const until = Date.now() + backoff;
  await setState("cooldown", {
    consecutiveFailures: consecutive,
    cooldownUntil: new Date(until).toISOString(),
    rateLimitedAt: new Date().toISOString(),
    lastError: raw,
    backoffMs: backoff,
  });

  return until;
}

async function recordSuccess() {
  const cd = await getCooldown();
  if (cd.consecutiveFailures > 0) {
    await setState("cooldown", {
      ...cd,
      consecutiveFailures: 0,
      cooldownUntil: null,
      lastError: null,
    });
  }
}

async function bumpUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const quota = await getQuota();
  if (quota.date === today) {
    await setState("quota", { ...quota, count: (quota.count || 0) + 1 });
  } else {
    // New day — reset count, keep cooldown fields intact.
    await setState("quota", {
      date: today,
      count: 1,
      rateLimitedAt: quota.rateLimitedAt,
      lastError: quota.lastError,
    });
  }
}

// ---------------------------------------------------------------------------
// Image loading + Gemini call
// ---------------------------------------------------------------------------

async function loadImageData(objectKey) {
  const res = await r2.send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: objectKey }),
  );
  if (!res.Body) throw new Error("image body is empty");
  const MAX_AI_BYTES = 50 * 1024 * 1024;
  let totalBytes = 0;
  const chunks = [];
  for await (const chunk of res.Body) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_AI_BYTES) {
      throw new Error("image exceeds 50 MB limit for AI tagging");
    }
    chunks.push(chunk);
  }
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
    /busy|high demand|overloaded|rate|quota|unavailable|timed?\s*out/i.test(
      raw,
    )
  );
}

// ---------------------------------------------------------------------------
// Atomic tag merge with row lock — prevents concurrent writers from
// overwriting each other's tags.
// ---------------------------------------------------------------------------

async function mergeTagsForImage(objectKey, newTags) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT tags FROM images WHERE object_key = $1 FOR UPDATE`,
      [objectKey],
    );
    if (rows.length === 0) throw new Error("image not found");
    const merged = mergeTags(rows[0].tags, newTags);
    await client.query(
      `UPDATE images SET tags = $1 WHERE object_key = $2`,
      [merged.join(" "), objectKey],
    );
    await client.query("COMMIT");
    return merged;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Job processing
// ---------------------------------------------------------------------------

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

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Gemini request timed out")), GEMINI_TIMEOUT_MS);
    });

    const response = await Promise.race([
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          { inlineData: { mimeType: mime, data } },
          `${prompt}\nRespond ONLY with a JSON array of strings, e.g. ["tag1","tag2"].`,
        ],
      }),
      timeoutPromise,
    ]);
    clearTimeout(timeoutId);

    const tags = parseTags(response.text);
    if (!tags) throw new Error("Gemini response was not a tag array");

    await bumpUsage();
    await recordSuccess();

    const merged = await mergeTagsForImage(job.object_key, tags);
    await pool.query(
      `UPDATE images SET ai_tagged = true WHERE object_key = $1`,
      [job.object_key],
    );
    await pool.query(
      `UPDATE ai_jobs SET status = 'done', result_tags = $1, error = '', finished_at = now() WHERE id = $2`,
      [tags.join(" "), job.id],
    );
  } catch (err) {
    const raw = String(err?.message || "AI tagging failed").slice(0, 500);
    console.error("AI tagging failed:", raw);

    if (isRetryable(err) && job.attempts < MAX_ATTEMPTS) {
      await recordRateLimit(err);
      await pool.query(
        `UPDATE ai_jobs SET status = 'queued', error = $1 WHERE id = $2`,
        [raw, job.id],
      );
    } else {
      const finalError = job.attempts >= MAX_ATTEMPTS
        ? `Max retries (${MAX_ATTEMPTS}) exceeded: ${raw}`
        : raw;
      await pool.query(
        `UPDATE ai_jobs SET status = 'failed', error = $1, finished_at = now() WHERE id = $2`,
        [finalError, job.id],
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-cleanup: remove finished jobs older than 1 hour
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL_MS = 5 * 60_000; // run every 5 minutes
const JOB_TTL_MS = 60 * 60_000; // 1 hour

let cleanupTimer = null;

async function cleanupOldJobs() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ai_jobs
       WHERE status IN ('done', 'failed', 'canceled')
         AND finished_at < now() - interval '1 hour'`,
    );
    if (rowCount > 0) {
      console.log(`[aiQueue] cleaned up ${rowCount} old job(s)`);
    }
  } catch {
    // DB not ready yet — will retry next cycle.
  }
}

// ---------------------------------------------------------------------------
// Drain loop
// ---------------------------------------------------------------------------

let lastCallAt = 0;
let processing = false;

async function drain() {
  if (processing) return;
  processing = true;
  try {
    if (await getPaused()) return;

    // Recover stuck running jobs (no updated_at on ai_jobs — use started_at)
    await pool.query(
      `UPDATE ai_jobs SET status = 'queued', error = 'recovered from stuck running'
       WHERE status = 'running' AND started_at < now() - interval '2 minutes'`,
    );

    const rl = await getRateLimitStatus();
    if (rl.rate_limited) {
      // Sleep until cooldown clears — don't busy-loop.
      const sleepMs = Math.max(0, rl.until - Date.now()) + 1000;
      if (sleepMs > 0 && sleepMs < RATE_LIMIT_MEMORY_MS) {
        scheduleDrain(sleepMs);
      }
      return;
    }

    const cfg = await getConfig();
    const wait = lastCallAt + cfg.min_interval_ms - Date.now();
    if (wait > 0) {
      scheduleDrain(wait);
      return;
    }

    const { rows } = await pool.query(
      `SELECT * FROM ai_jobs WHERE status = 'queued'
       ORDER BY priority DESC, created_at ASC LIMIT 1`,
    );
    if (rows.length === 0) return;

    lastCallAt = Date.now();
    await processJob(rows[0]);
  } catch (err) {
    if (!/connection|ECONNREFUSED|pool/i.test(String(err?.message || ""))) {
      console.error("[aiQueue] drain error:", err.message);
    }
  } finally {
    processing = false;
  }
}

function scheduleDrain(ms) {
  if (activeTimeout) clearTimeout(activeTimeout);
  activeTimeout = setTimeout(() => {
    activeTimeout = null;
    drain();
  }, Math.min(ms, 60_000));
  activeTimeout.unref();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startQueue() {
  if (process.env.AI_QUEUE === "false") return;
  if (drainTimer || !isGeminiConfigured()) return;

  // Recover orphaned "running" jobs (stuck for >2 minutes, e.g. after deploy)
  try {
    const res = await pool.query(
      `UPDATE ai_jobs SET status = 'queued', error = 'recovered from stuck running'
       WHERE status = 'running' AND started_at < now() - interval '2 minutes'`,
    );
    if (res.rowCount > 0) {
      console.log(`[aiQueue] recovered ${res.rowCount} stuck running job(s)`);
    }
  } catch {
    // DB not ready yet — will retry on next drain.
  }

  // Run cleanup once on start, then every 5 minutes
  cleanupOldJobs();
  cleanupTimer = setInterval(cleanupOldJobs, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  drainTimer = setInterval(drain, 10_000);
  drainTimer.unref();
  drain();
}

export function stopQueue() {
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  if (activeTimeout) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }
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
    // DB not ready yet.
  }
  return counts;
}

export { VALID_STATUSES, RATE_LIMIT_MEMORY_MS };
