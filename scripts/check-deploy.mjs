#!/usr/bin/env node
/**
 * Deployment smoke test — point it at any Kashida Archive deployment:
 *   node scripts/check-deploy.mjs https://kashida-archive-production-xxxx.up.railway.app
 * Exits non-zero if any check fails.
 */

const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!base) {
  console.error("usage: node scripts/check-deploy.mjs <base-url>");
  process.exit(2);
}

let failed = 0;

const check = async (name, fn) => {
  try {
    const out = await fn();
    console.log(`  ok    ${name}${out ? "  — " + out : ""}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}  — ${err.message}`);
  }
};

console.log(`Deployment check: ${base}\n`);

await check("GET /api/health", async () => {
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(`body.ok is false: ${JSON.stringify(body)}`);
  if (body.db !== true) throw new Error(`database NOT ready (db=${body.db}) — DATABASE_URL missing or unreachable`);
  return `service up, db ready`;
});

await check("GET / (SPA)", async () => {
  const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(10000) });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!/<!doctype html/i.test(text)) throw new Error("response is not HTML");
  return res.headers.get("content-type") || "text/html";
});

await check("GET /api/images?view=all", async () => {
  const res = await fetch(`${base}/api/images?view=all`, { signal: AbortSignal.timeout(10000) });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("response is not an array");
  return `${body.length} image(s)`;
});

await check("GET /api/search?q=news", async () => {
  const res = await fetch(`${base}/api/search?q=news`, { signal: AbortSignal.timeout(10000) });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("response is not an array");
  return `${body.length} result(s)`;
});

await check("POST /api/upload-url validation", async () => {
  const res = await fetch(`${base}/api/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  return "rejects missing filename";
});

console.log(
  failed
    ? `\n${failed} check(s) FAILED`
    : "\nall checks passed — deployment is healthy",
);
process.exit(failed ? 1 : 0);