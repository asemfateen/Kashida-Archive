import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pool from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");

try {
  await pool.query(schema);
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
} catch (err) {
  console.error("Schema init failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
