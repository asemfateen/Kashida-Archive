import { before, after, test } from "node:test";
import assert from "node:assert/strict";

// Configure the tag route's guards before importing the server so the
// SSRF allowlist and fetch path are reachable in these tests.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";
// Keep the background AI queue worker idle: it would otherwise drain the
// shared dev DB while other parallel test files create jobs.
process.env.AI_QUEUE = "false";

const { app, server: moduleServer } = await import("../src/index.js");
const { RATE_UPLOAD } = await import("../src/index.js");
const pool = await import("../src/db.js").then((m) => m.default);

const TEST_PREFIX = `edge/${Date.now()}`;
let server;
let base;
let token;

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

// The suite asserts the unconfigured-server responses (R2/Gemini 500s), so it
// must be immune to the calling environment's real creds. Save and clear the
// config env vars for the duration of the suite; the routes read them per
// request, so runtime deletion is enough even if server/.env was loaded.
const ENV_KEYS = [
  "GEMINI_API_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
];
const savedEnv = {};

before(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GEMINI_API_KEY = "test-key"; // SSRF check needs a configured Gemini
  await pool.query(`DELETE FROM images WHERE object_key LIKE $1`, [
    `${TEST_PREFIX}/%`,
  ]);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.R2_PUBLIC_BASE_URL = base; // tag fetch tests point at ourselves
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  assert.equal(login.status, 200, "dev creds admin/admin must log in");
  token = (await login.json()).token;
});

after(async () => {
  server?.close();
  moduleServer?.close();
  await pool.query(`DELETE FROM images WHERE object_key LIKE $1`, [
    `${TEST_PREFIX}/%`,
  ]);
  await pool.query(`DELETE FROM ai_jobs WHERE object_key LIKE $1`, [
    `${TEST_PREFIX}/%`,
  ]);
  await pool.end();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test("search survives array and object q (regression: process crash)", async () => {
  const array = await j("/api/search?q=protest&q=crowd");
  assert.equal(array.status, 200);
  const object = await j("/api/search?q[x]=1");
  assert.equal(object.status, 200);
  assert.ok(Array.isArray(object.body));
});

test("POST /api/images rejects oversized and NUL-laden keys", async () => {
  const long = "a".repeat(513);
  assert.equal(
    (
      await j("/api/images", {
        method: "POST",
        body: JSON.stringify({ objectKey: long, originalFilename: "a.jpg" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await j("/api/images", {
        method: "POST",
        body: JSON.stringify({
          objectKey: key("ok"),
          originalFilename: long,
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await j("/api/images", {
        method: "POST",
        body: JSON.stringify({
          objectKey: key("ok"),
          originalFilename: "a\u0000b.jpg",
        }),
      })
    ).status,
    400,
  );
});

test("POST /api/upload-url rejects invalid contentType", async () => {
  RATE_UPLOAD.reset(); // api.test.js may have consumed the upload budget
  assert.equal(
    (
      await j("/api/upload-url", {
        method: "POST",
        body: JSON.stringify({
          filename: "photo.jpg",
          contentType: "../evil\n",
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await j("/api/upload-url", {
        method: "POST",
        body: JSON.stringify({
          filename: "photo.jpg",
          contentType: "image/jpeg",
        }),
      })
    ).status,
    500, // R2 unconfigured in tests
  );
});

test("GET /api/images/:objectKey returns a row or 404", async () => {
  await j("/api/images", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key("single"),
      originalFilename: "single.jpg",
    }),
  });
  const ok = await j(`/api/images/${encodeURIComponent(key("single"))}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.object_key, key("single"));
  const missing = await j("/api/images/test%2Fnot-there.jpg");
  assert.equal(missing.status, 404);
});

test("literal /api/images/tag is not shadowed by the :objectKey route", async () => {
  assert.equal((await j("/api/images/tag")).status, 405);
  assert.equal(
    (await j("/api/images/tag", { method: "PATCH", body: "{}" })).status,
    405,
  );
  assert.equal((await j("/api/images/tag", { method: "DELETE" })).status, 405);
});

test("PATCH tags rejects NUL and oversized values", async () => {
  await j("/api/images", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key("tags"),
      originalFilename: "tags.jpg",
    }),
  });
  const nul = await j(`/api/images/${encodeURIComponent(key("tags"))}`, {
    method: "PATCH",
    body: JSON.stringify({ tags: "a\u0000b" }),
  });
  assert.equal(nul.status, 400);
  const long = await j(`/api/images/${encodeURIComponent(key("tags"))}`, {
    method: "PATCH",
    body: JSON.stringify({ tags: "a".repeat(2001) }),
  });
  assert.equal(long.status, 400);
});

test("malformed JSON body -> 400 JSON, oversized body -> 413 JSON", async () => {
  const malformed = await fetch(`${base}/api/images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: "{not json",
  });
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.json();
  assert.equal(malformedBody.error, "invalid JSON body");

  const big = JSON.stringify({
    objectKey: "x".repeat(16 * 1024 * 1024),
    originalFilename: "big.jpg",
  });
  const oversized = await fetch(`${base}/api/images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: big,
  });
  assert.equal(oversized.status, 413);
  const oversizedBody = await oversized.json();
  assert.equal(oversizedBody.error, "request body too large");
});

test("unknown /api route -> 404 JSON", async () => {
  const { status, body } = await j("/api/nope/does-not-exist");
  assert.equal(status, 404);
  assert.equal(body.error, "not found");
});

test("tag route enqueues into the AI queue", async () => {
  const missing = await j("/api/images/tag", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(missing.status, 400);

  const enqueued = await j("/api/images/tag", {
    method: "POST",
    body: JSON.stringify({ objectKey: key("tag") }),
  });
  assert.equal(enqueued.status, 201);
  assert.equal(enqueued.body.queued, true);
  assert.ok(typeof enqueued.body.jobId === "string");
});

test("concurrent duplicate saves: exactly one 201, rest 409", async () => {
  const body = JSON.stringify({
    objectKey: key("race"),
    originalFilename: "race.jpg",
  });
  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      j("/api/images", { method: "POST", body }),
    ),
  );
  const created = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);
  assert.equal(created.length, 1);
  assert.equal(conflicts.length, 49);
});

test("concurrent searches all succeed", async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, () => j("/api/search?q=protest")),
  );
  assert.ok(results.every((r) => r.status === 200));
});

test("rate limiter kicks in on burst of upload-url requests", async () => {
  RATE_UPLOAD.reset();
  const results = await Promise.all(
    Array.from({ length: 620 }, () =>
      j("/api/upload-url", {
        method: "POST",
        body: JSON.stringify({ filename: "burst.jpg" }),
      }),
    ),
  );
  const statuses = results.map((r) => r.status);
  const throttled = statuses.filter((s) => s === 429);
  assert.ok(throttled.length > 0, "expected at least one 429");
  assert.equal(
    throttled.length + statuses.filter((s) => s === 500).length,
    620,
  );
});

test("mergeTags appends new tags and dedupes case-insensitively", async () => {
  const { mergeTags } = await import("../src/tagParser.js");

  // Existing tags are preserved, AI tags appended.
  assert.deepEqual(mergeTags("breaking news", ["election", "city"]), [
    "breaking",
    "news",
    "election",
    "city",
  ]);

  // Duplicates across existing/new are dropped (case-insensitive), keeping
  // the existing casing.
  assert.deepEqual(mergeTags("Breaking NEWS", ["breaking", "Election"]), [
    "Breaking",
    "NEWS",
    "Election",
  ]);

  // New duplicates are dropped while new unique tags append.
  assert.deepEqual(mergeTags("", ["a", "A", "b", "a"]), ["a", "b"]);

  // Empty existing string and empty incoming both yield [].
  assert.deepEqual(mergeTags("", []), []);
  assert.deepEqual(mergeTags("  ", null), []);
});
