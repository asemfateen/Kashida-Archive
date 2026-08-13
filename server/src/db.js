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

// Make pool.end() idempotent so a double close (e.g. two test files sharing
// the pool) never throws "Cannot use a pool after calling end".
let poolEnded = false;
const endPool = pool.end.bind(pool);
pool.end = () => {
  if (poolEnded) return Promise.resolve();
  poolEnded = true;
  return endPool();
};

export default pool;
