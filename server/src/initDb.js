import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pool from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");

const RETRIES = Math.max(
  1,
  Number.parseInt(process.env.DB_INIT_RETRIES || "20", 10) || 1,
);
const RETRY_DELAY_MS = Math.max(
  0,
  Number.parseInt(process.env.DB_INIT_RETRY_DELAY_MS || "3000", 10) || 0,
);

export async function initDb({ log = true } = {}) {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    if (log) {
      console.error("[db] DATABASE_URL is not set. In production, a Postgres database is required.");
      console.error("[db] Set DATABASE_URL to a reachable Postgres, e.g. DATABASE_URL=postgresql://user:pass@host:5432/dbname");
      console.error("[db] Returning false — app will run in degraded mode and serve 503 responses.");
    }
    return false; // Don't throw — let the app handle it gracefully
  }

  if (log) {
    console.log(
      `[db] connecting via ${process.env.DATABASE_URL ? "DATABASE_URL" : "fallback localhost URL"} (${process.env.DATABASE_URL ? "postgresql://***@***/***" : "postgres://smart_archive:***@localhost:5432/smart_image_archive"})`,
    );
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      await pool.query(schema);
      if (log) {
        const { rows } = await pool.query(`
          SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'images' ORDER BY ordinal_position
        `);
        console.log("Schema applied. images columns:");
        for (const col of rows)
          console.log(`  ${col.column_name} (${col.data_type})`);
        const idx = await pool.query(`
          SELECT indexname FROM pg_indexes WHERE tablename = 'images'
        `);
        console.log("Indexes:", idx.rows.map((r) => r.indexname).join(", "));
      }
      return true;
    } catch (err) {
      lastErr = err;
      if (log) {
        const detail = err?.errors?.length
          ? err.errors
              .map((e) => `${e.code || e.name || "?"}:${e.message}`)
              .join(" | ")
          : `${err?.code || err?.name || "?"}:${err?.message || String(err)}`;
        console.error(
          `[db] schema init attempt ${attempt}/${RETRIES} failed: ${detail}`,
        );
      }
      if (attempt < RETRIES)
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  if (log) {
    console.error(
      `[db] FATAL — could not reach the database after ${RETRIES} attempts`,
    );
    console.error(lastErr?.stack || lastErr);
    console.error(
      "[db] Set DATABASE_URL to a reachable Postgres, e.g. DATABASE_URL=postgresql://user:pass@host:5432/dbname",
    );
  }
  return false;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  const ok = await initDb();
  await pool.end();
  if (!ok) process.exitCode = 1;
}

export default initDb;

