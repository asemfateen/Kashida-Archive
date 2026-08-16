import { before, after, test } from "node:test";
import assert from "node:assert/strict";

// Keep the background queue worker idle for this suite: set the opt-out flag
// and clear the Gemini key BEFORE the server module loads, otherwise the
// worker starts during import and races these assertions.
process.env.AI_QUEUE = "false";
delete process.env.GEMINI_API_KEY;

const { app, server: moduleServer } = await import("../src/index.js");
const pool = (await import("../src/db.js")).default;

const TEST_PREFIX = `test/${Date.now()}`;
let server;
let base;
let token;

// The suite asserts the unconfigured-server responses (R2/Gemini 500s), so it
// must be immune to the calling environment's real creds. Save and clear the
// config env vars for the duration of the suite.
const ENV_KEYS = [
  "GEMINI_API_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
];
const savedEnv = {};
const savedState = [];

const key = (name) => `${TEST_PREFIX}/${name}.jpg`;

const j = async (path, opts) => {
  const res = await fetch(`${base}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...opts,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body };
};

const makeImage = async (name, filename) => {
  const res = await j("/api/images", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key(name),
      originalFilename: filename || `${name}.jpg`,
    }),
  });
  assert.equal(res.status, 201);
  return key(name);
};

const setJobStatus = async (objectKey, status) => {
  await pool.query(
    `UPDATE ai_jobs SET status = $1, error = CASE WHEN $1 = 'failed' THEN 'forced' ELSE error END
     WHERE object_key = $2`,
    [status, objectKey],
  );
};

before(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  const state = await pool.query(`SELECT key, value FROM ai_state`);
  savedState.push(...state.rows);
  await pool.query(`DELETE FROM ai_state`);
  await pool.query(`DELETE FROM ai_jobs`);
  await pool.query(`DELETE FROM images WHERE object_key LIKE 'test/%'`);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  assert.equal(login.status, 200);
  token = (await login.json()).token;
});

after(async () => {
  server?.close();
  moduleServer?.close();
  await pool.query(`DELETE FROM ai_jobs WHERE object_key LIKE $1`, [
    `${TEST_PREFIX}/%`,
  ]);
  await pool.query(`DELETE FROM images WHERE object_key LIKE $1`, [
    `${TEST_PREFIX}/%`,
  ]);
  await pool.query(`DELETE FROM ai_state`);
  for (const row of savedState) {
    await pool.query(`INSERT INTO ai_state (key, value) VALUES ($1, $2)`, [
      row.key,
      row.value,
    ]);
  }
  await pool.end();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test("AI routes require auth", async () => {
  for (const path of ["/api/ai/status", "/api/ai/jobs", "/api/ai/config"]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 401, `${path} must 401 without a token`);
  }
});

test("GET /api/ai/status reports defaults", async () => {
  const { status, body } = await j("/api/ai/status");
  assert.equal(status, 200);
  assert.equal(body.configured, false);
  assert.equal(typeof body.model, "string");
  assert.equal(body.paused, false);
  assert.equal(
    body.config.master_prompt,
    "Give me 5 descriptive keywords for this image.",
  );
  assert.ok(body.config.min_interval_ms >= 0);
  assert.ok(body.config.daily_limit >= 1);
  assert.equal(body.quota.usage, 0);
  assert.equal(body.quota.rate_limited, false);
  for (const key of ["queued", "running", "done", "failed", "canceled"]) {
    assert.equal(typeof body.queue[key], "number");
    assert.ok(body.queue[key] >= 0);
  }
});

test("POST /api/ai/jobs enqueues, dedupes and skips active keys", async () => {
  const k1 = await makeImage("q1");
  const k2 = await makeImage("q2");
  const k3 = await makeImage("q3");

  const first = await j("/api/ai/jobs", {
    method: "POST",
    body: JSON.stringify({ objectKeys: [k1, k2] }),
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.enqueued, 2);
  assert.equal(first.body.jobs.length, 2);

  // k1 is already queued -> skipped; k3 is new -> enqueued; k1 again is deduped.
  const second = await j("/api/ai/jobs", {
    method: "POST",
    body: JSON.stringify({ objectKeys: [k1, k1, k3] }),
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.enqueued, 1);
  assert.equal(second.body.skipped, 1);

  const third = await j("/api/ai/jobs", {
    method: "POST",
    body: JSON.stringify({ objectKeys: [k1, k2, k3] }),
  });
  assert.equal(third.body.enqueued, 0);
  assert.equal(third.body.skipped, 3);
});

test("POST /api/ai/jobs validates input", async () => {
  assert.equal(
    (await j("/api/ai/jobs", { method: "POST", body: JSON.stringify({}) }))
      .status,
    400,
  );
  assert.equal(
    (
      await j("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify({ objectKeys: [] }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await j("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify({ objectKeys: Array(501).fill(key("x")) }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await j("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify({
          objectKeys: [key("x")],
          prompt: "a".repeat(2001),
        }),
      })
    ).status,
    400,
  );
});

test("GET /api/ai/jobs lists with image metadata and filters by status", async () => {
  const { status, body } = await j("/api/ai/jobs");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  const mine = body.filter((r) => r.object_key.startsWith(TEST_PREFIX));
  assert.equal(mine.length, 3);
  assert.ok(mine.every((r) => typeof r.original_filename === "string"));
  assert.ok(mine.every((r) => typeof r.thumb === "string"));

  const { body: queued } = await j("/api/ai/jobs?status=queued");
  const queuedMine = queued.filter((r) => r.object_key.startsWith(TEST_PREFIX));
  assert.equal(queuedMine.length, 3);

  assert.equal((await j("/api/ai/jobs?status=bogus")).status, 400);
});

test("PATCH /api/ai/jobs/:id cancels a queued job and edits its prompt", async () => {
  const k = await makeImage("patch1");
  const { body: created } = await j("/api/ai/jobs", {
    method: "POST",
    body: JSON.stringify({ objectKeys: [k] }),
  });
  const id = created.jobs[0].id;

  const promptEdit = await j(`/api/ai/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ prompt: "focus on faces" }),
  });
  assert.equal(promptEdit.status, 200);
  assert.equal(promptEdit.body.prompt, "focus on faces");

  const cancel = await j(`/api/ai/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "canceled" }),
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, "canceled");

  // Canceling a finished job is rejected.
  const again = await j(`/api/ai/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "canceled" }),
  });
  assert.equal(again.status, 400);

  const missing = await j("/api/ai/jobs/00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    body: JSON.stringify({ status: "canceled" }),
  });
  assert.equal(missing.status, 404);
});

test("retry and cancel-all requeue/cancel jobs, delete removes finished", async () => {
  const k1 = await makeImage("r1");
  const k2 = await makeImage("r2");
  await j("/api/ai/jobs", {
    method: "POST",
    body: JSON.stringify({ objectKeys: [k1, k2] }),
  });
  await setJobStatus(k1, "failed");
  await setJobStatus(k2, "failed");

  const retryAll = await j("/api/ai/jobs/retry-failed", { method: "POST" });
  assert.equal(retryAll.body.requeued, 2);

  await setJobStatus(k1, "done");
  await setJobStatus(k2, "failed");
  const k1Id = await keyToId(k1);
  const retryOne = await j(`/api/ai/jobs/${k1Id}/retry`, {
    method: "POST",
  });
  assert.equal(retryOne.status, 404); // done jobs are not retryable

  const { body: failed } = await j("/api/ai/jobs?status=failed");
  const myFailed = failed.filter((r) => r.object_key.startsWith(TEST_PREFIX));
  assert.equal(myFailed.length, 1);
  assert.equal(myFailed[0].object_key, k2);

  // Cancel everything currently queued — capture the count first so the
  // assertion is immune to any jobs other parallel test files may have added.
  const { body: beforeCancel } = await j("/api/ai/status");
  const cancelAll = await j("/api/ai/jobs/cancel-all", { method: "POST" });
  assert.equal(cancelAll.body.canceled, beforeCancel.queue.queued);
});

test("POST /api/ai/jobs/:id/retry re-queues a failed job and resets attempts", async () => {
  const k = await makeImage("retryme");
  const { body: created } = await j("/api/ai/jobs", {
    method: "POST",
    body: JSON.stringify({ objectKeys: [k] }),
  });
  const id = created.jobs[0].id;
  await setJobStatus(k, "failed");
  await pool.query(`UPDATE ai_jobs SET attempts = 4 WHERE id = $1`, [id]);

  const retry = await j(`/api/ai/jobs/${id}/retry`, { method: "POST" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, "queued");
  assert.equal(retry.body.error, "");
  assert.equal(retry.body.attempts, 0);
});

test("DELETE /api/ai/jobs/:id only removes finished jobs", async () => {
  const k = await makeImage("del1");
  const { body: created } = await j("/api/ai/jobs", {
    method: "POST",
    body: JSON.stringify({ objectKeys: [k] }),
  });
  const id = created.jobs[0].id;

  // Queued jobs can't be deleted.
  const queued = await j(`/api/ai/jobs/${id}`, { method: "DELETE" });
  assert.equal(queued.status, 400);

  await setJobStatus(k, "done");
  const done = await j(`/api/ai/jobs/${id}`, { method: "DELETE" });
  assert.equal(done.status, 200);
  assert.equal(done.body.deleted, 1);
});

test("GET/PATCH /api/ai/config reads and updates settings", async () => {
  const { body } = await j("/api/ai/config");
  assert.equal(body.paused, false);
  assert.ok(body.config.master_prompt);

  const patch = await j("/api/ai/config", {
    method: "PATCH",
    body: JSON.stringify({
      master_prompt: "describe the news scene",
      min_interval_ms: 2500,
      daily_limit: 40,
      paused: true,
    }),
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.config.master_prompt, "describe the news scene");
  assert.equal(patch.body.config.min_interval_ms, 2500);
  assert.equal(patch.body.config.daily_limit, 40);
  assert.equal(patch.body.paused, true);

  const status = await j("/api/ai/status");
  assert.equal(status.body.paused, true);

  // Regression: config/quota are stored as JSONB objects, which pg returns
  // already-parsed. A JSON.parse() round-trip must not drop the persisted
  // values back to defaults.
  const reread = await j("/api/ai/config");
  assert.equal(reread.status, 200);
  assert.equal(reread.body.config.master_prompt, "describe the news scene");
  assert.equal(reread.body.config.min_interval_ms, 2500);
  assert.equal(reread.body.config.daily_limit, 40);

  const bad = await j("/api/ai/config", {
    method: "PATCH",
    body: JSON.stringify({ min_interval_ms: -5 }),
  });
  assert.equal(bad.status, 400);

  const badLimit = await j("/api/ai/config", {
    method: "PATCH",
    body: JSON.stringify({ daily_limit: 0 }),
  });
  assert.equal(badLimit.status, 400);

  // Restore defaults so other suites aren't affected.
  await j("/api/ai/config", {
    method: "PATCH",
    body: JSON.stringify({
      master_prompt: "Give me 5 descriptive keywords for this image.",
      min_interval_ms: 1500,
      daily_limit: 20,
      paused: false,
    }),
  });
});

async function keyToId(objectKey) {
  const { rows } = await pool.query(
    `SELECT id FROM ai_jobs WHERE object_key = $1 LIMIT 1`,
    [objectKey],
  );
  return rows[0]?.id;
}
