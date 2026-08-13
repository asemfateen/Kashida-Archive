import "./env.js";
import pg from "pg";

const raw =
  process.env.DATABASE_URL ||
  "postgres://smart_archive:smart_archive@localhost:5432/smart_image_archive";

const ssl = /sslmode=require/i.test(raw);
const connectionString = raw
  .replace(/[?&]sslmode=require/i, "")
  .replace(/[?&]$/, "");

const pool = new pg.Pool({
  connectionString,
  ssl: ssl ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
});

export default pool;
