import { before, after, test } from "node:test";
import assert from "node:assert/strict";

// Configure the tag route's guards before importing the server so the
// SSRF allowlist and fetch path are reachable in these tests.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";

const { app, server: moduleServer } = await import("../src/index.js");
const pool = await import("../src/db.js").then((m) => m.default);

const TEST_PREFIX = `edge/${Date.now()}`;
let server;
let base;

const key = (name) => `${TEST_PREFIX}/${name}.jpg`;

const j = async (path, opts) => {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
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

before(async () => {
  await pool.query(`DELETE FROM images WHERE object_key LIKE $1`, [
    `${TEST_PREFIX}/%`,
  ]);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.R2_PUBLIC_BASE_URL = base; // tag fetch tests point at ourselves
});

after(async () => {
  server?.close();
  moduleServer?.close();
  await pool.query(`DELETE FROM images WHERE object_key LIKE $1`, [
    `${TEST_PREFIX}/%`,
  ]);
  await pool.end();
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

test("malformed JSON body -> 400 JSON, oversized body -> 413 JSON", async () => {
  const malformed = await fetch(`${base}/api/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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

test("tag route blocks SSRF imageUrl and gates the fetch path", async () => {
  const evil = await j("/api/images/tag", {
    method: "POST",
    body: JSON.stringify({ objectKey: key("tag"), imageUrl: "https://evil.example/x.jpg" }),
  });
  assert.equal(evil.status, 400);

  const fileScheme = await j("/api/images/tag", {
    method: "POST",
    body: JSON.stringify({ objectKey: key("tag"), imageUrl: "file:///etc/passwd" }),
  });
  assert.equal(fileScheme.status, 400);

  const notImage = await j("/api/images/tag", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key("tag"),
      imageUrl: `${base}/api/health`,
    }),
  });
  assert.equal(notImage.status, 502); // our own origin but non-image content-type

  const missing = await j("/api/images/tag", {
    method: "POST",
    body: JSON.stringify({ objectKey: key("tag"), imageUrl: `${base}/gone.jpg` }),
  });
  assert.equal(missing.status, 502);

  const noSource = await j("/api/images/tag", {
    method: "POST",
    body: JSON.stringify({ objectKey: key("tag") }),
  });
  assert.equal(noSource.status, 400);
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
  const results = await Promise.all(
    Array.from({ length: 130 }, () =>
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
    130,
  );
});
