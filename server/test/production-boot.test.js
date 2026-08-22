import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER_DIR = fileURLToPath(new URL("../", import.meta.url));

const pickPort = () => 30000 + Math.floor(Math.random() * 20000);

async function waitFor(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      return res;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never came up on ${url}`);
}

function startServer(extraEnv = {}) {
  const port = pickPort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DB_INIT_RETRIES: "5",
      DB_INIT_RETRY_DELAY_MS: "200",
      AI_QUEUE: "false",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (d) => (logs += d));
  child.stderr.on("data", (d) => (logs += d));
  return { child, port, logs: () => logs };
}

const distExists = existsSync(
  new URL("../../client/dist/index.html", import.meta.url),
);

test("production boot (Railway parity): healthy DB — migration, SPA and API all live", async () => {
  const { child, port } = startServer({
    ADMIN_USER: "admin",
    ADMIN_PASS: "s3cret",
    JWT_SECRET: "boot-test-secret",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const health = await waitFor(`${base}/api/health`);
    assert.equal(health.status, 200);
    const hb = await health.json();
    assert.equal(hb.ok, true);
    assert.equal(hb.db, true);

    // The API is behind admin auth; log in to get a token.
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "s3cret" }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.ok(typeof token === "string" && token.length > 10);

    const list = await fetch(`${base}/api/images?view=all`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(await list.json()));

    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type"), /text\/html/);
  } finally {
    child.kill();
  }
});

test("production boot (Railway parity): no database — stays up, 503 guard + setup page", async () => {
  const { child, port } = startServer({
    DATABASE_URL: "postgres://u:p@127.0.0.1:59999/nodb",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const health = await waitFor(`${base}/api/health`);
    const hb = await health.json();
    assert.equal(hb.ok, false);
    assert.equal(hb.db, false);

    const img = await fetch(`${base}/api/images`);
    assert.equal(img.status, 503);

    const root = await fetch(`${base}/`);
    if (distExists) {
      assert.equal(root.status, 503);
      assert.match(await root.text(), /Database is not ready/);
    }
  } finally {
    child.kill();
  }
});

test("production boot: healthy scenario serves the built SPA", async () => {
  if (!distExists) return;
  const { child, port } = startServer();
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/api/health`);
    const root = await fetch(`${base}/`);
    const html = await root.text();
    assert.match(html, /<div id="root">/);
    assert.match(html, /assets\/index-.*\.js/);
  } finally {
    child.kill();
  }
});
