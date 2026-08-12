import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/index.js";
import pool from "../src/db.js";

const TEST_PREFIX = `test/${Date.now()}`;
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
  await pool.query(`DELETE FROM images WHERE object_key LIKE 'test/%'`);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await pool.query(`DELETE FROM images WHERE object_key LIKE $1`, [
    `${TEST_PREFIX}/%`,
  ]);
  await pool.end();
});

test("GET /api/health returns ok", async () => {
  const { status, body } = await j("/api/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "smart-image-archive");
  assert.equal(body.db, true);
});

test("POST /api/images rejects missing fields", async () => {
  assert.equal(
    (await j("/api/images", { method: "POST", body: JSON.stringify({}) }))
      .status,
    400,
  );
  assert.equal(
    (
      await j("/api/images", {
        method: "POST",
        body: JSON.stringify({ objectKey: key("a") }),
      })
    ).status,
    400,
  );
});

test("POST /api/images saves a row and 409s on duplicates", async () => {
  const body = JSON.stringify({
    objectKey: key("dup"),
    originalFilename: "dup.jpg",
  });
  const first = await j("/api/images", { method: "POST", body });
  assert.equal(first.status, 201);
  assert.equal(first.body.object_key, key("dup"));
  assert.equal(first.body.tags, "");
  const second = await j("/api/images", { method: "POST", body });
  assert.equal(second.status, 409);
});

test("GET /api/images lists only non-deleted by default", async () => {
  await j("/api/images", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key("listme"),
      originalFilename: "listme.jpg",
    }),
  });
  const { status, body } = await j("/api/images?view=all");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.some((i) => i.object_key === key("listme")));
  assert.ok(!body.some((i) => i.deleted === true));
  assert.ok(body.every((i) => "url" in i));
});

test("POST /api/upload-url validates filename and extension", async () => {
  assert.equal(
    (await j("/api/upload-url", { method: "POST", body: JSON.stringify({}) }))
      .status,
    400,
  );
  assert.equal(
    (
      await j("/api/upload-url", {
        method: "POST",
        body: JSON.stringify({ filename: "weird.txt" }),
      })
    ).status,
    400,
  );
  const { status, body } = await j("/api/upload-url", {
    method: "POST",
    body: JSON.stringify({ filename: "photo.JPEG" }),
  });
  assert.equal(status, 500); // R2 unconfigured in tests
  assert.ok(body.error.includes("R2"));
});

test("PATCH /api/images updates tags, favorite, deleted", async () => {
  await j("/api/images", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key("patch"),
      originalFilename: "patch.jpg",
    }),
  });

  const tagRes = await j(`/api/images/${encodeURIComponent(key("patch"))}`, {
    method: "PATCH",
    body: JSON.stringify({ tags: "breaking news election" }),
  });
  assert.equal(tagRes.status, 200);
  assert.equal(tagRes.body.tags, "breaking news election");

  const favRes = await j(`/api/images/${encodeURIComponent(key("patch"))}`, {
    method: "PATCH",
    body: JSON.stringify({ favorite: true }),
  });
  assert.equal(favRes.body.favorite, true);

  const nothing = await j(`/api/images/${encodeURIComponent(key("patch"))}`, {
    method: "PATCH",
    body: JSON.stringify({}),
  });
  assert.equal(nothing.status, 400);

  const missing = await j("/api/images/test%2Fdoes-not-exist.jpg", {
    method: "PATCH",
    body: JSON.stringify({ tags: "x" }),
  });
  assert.equal(missing.status, 404);
});

test("GET /api/images?favorites only returns favorited", async () => {
  const { status, body } = await j("/api/images?view=favorites");
  assert.equal(status, 200);
  const mine = body.filter((i) => i.object_key.startsWith(TEST_PREFIX));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].object_key, key("patch"));
  assert.equal(mine[0].favorite, true);
});

test("DELETE soft-deletes, trash view shows it, PATCH restores", async () => {
  await j("/api/images", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key("trash"),
      originalFilename: "trash.jpg",
    }),
  });

  const del = await j(`/api/images/${encodeURIComponent(key("trash"))}`, {
    method: "DELETE",
  });
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { deleted: true });

  const trash = await j("/api/images?view=trash");
  assert.ok(trash.body.some((i) => i.object_key === key("trash")));

  const all = await j("/api/images?view=all");
  assert.ok(!all.body.some((i) => i.object_key === key("trash")));

  const restore = await j(`/api/images/${encodeURIComponent(key("trash"))}`, {
    method: "PATCH",
    body: JSON.stringify({ deleted: false }),
  });
  assert.equal(restore.body.deleted, false);

  const missing = await j("/api/images/test%2Fnever-existed.jpg", {
    method: "DELETE",
  });
  assert.equal(missing.status, 404);
});

test("GET /api/search matches tags with rank ordering", async () => {
  await j("/api/images", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key("rank1"),
      originalFilename: "r1.jpg",
    }),
  });
  await j(`/api/images/${encodeURIComponent(key("rank1"))}`, {
    method: "PATCH",
    body: JSON.stringify({ tags: "protest crowd city rally" }),
  });
  await j("/api/images", {
    method: "POST",
    body: JSON.stringify({
      objectKey: key("rank2"),
      originalFilename: "r2.jpg",
    }),
  });
  await j(`/api/images/${encodeURIComponent(key("rank2"))}`, {
    method: "PATCH",
    body: JSON.stringify({ tags: "protest night" }),
  });

  const { status, body } = await j("/api/search?q=protest");
  assert.equal(status, 200);
  assert.ok(body.some((i) => i.object_key === key("rank1")));
  assert.ok(body.some((i) => i.object_key === key("rank2")));
  const rank1 = body.find((i) => i.object_key === key("rank1"));
  assert.ok(typeof rank1.rank === "number" && rank1.rank > 0);
});

test("GET /api/search ranks multi-tag matches higher", async () => {
  const { body } = await j("/api/search?q=protest+crowd");
  const mine = body.filter((i) => i.object_key.startsWith(TEST_PREFIX));
  assert.equal(mine.length, 2);
  const [first, second] = mine;
  assert.equal(first.object_key, key("rank1")); // matched both terms
  assert.equal(second.object_key, key("rank2"));
  assert.ok(Number(first.rank) >= Number(second.rank));
});

test("GET /api/search sort=newest and sort=oldest order by created_at", async () => {
  const newest = await j("/api/search?q=protest&sort=newest");
  const oldest = await j("/api/search?q=protest&sort=oldest");
  const pick = (body) =>
    body.filter((i) => i.object_key.startsWith(TEST_PREFIX));
  assert.deepEqual(
    pick(newest.body).map((i) => i.object_key),
    [...pick(oldest.body).map((i) => i.object_key)].reverse(),
  );
});

test("GET /api/search excludes deleted and handles empty input", async () => {
  await j(`/api/images/${encodeURIComponent(key("rank1"))}`, {
    method: "DELETE",
  });
  const { body } = await j("/api/search?q=protest");
  assert.ok(!body.some((i) => i.object_key === key("rank1")));

  assert.equal((await j("/api/search")).status, 400);
  const { status, body: emptyBody } = await j("/api/search?q=%21%21%21");
  assert.equal(status, 200);
  assert.deepEqual(emptyBody, []);
});

test("GET /api/search rejects dangerous SQL-only input", async () => {
  const { status, body } = await j(
    "/api/search?q=" + encodeURIComponent("'; DROP TABLE images; --"),
  );
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
});

test("POST /api/images/tag validates objectKey and config", async () => {
  assert.equal(
    (await j("/api/images/tag", { method: "POST", body: JSON.stringify({}) }))
      .status,
    400,
  );
  const { status, body } = await j("/api/images/tag", {
    method: "POST",
    body: JSON.stringify({ objectKey: key("tag") }),
  });
  assert.equal(status, 500);
  assert.ok(body.error.includes("Gemini"));
});
