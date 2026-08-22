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
  max: 20,
  idleTimeoutMillis: 30000,
});

// Prevent unhandled pool errors from crashing the process.
pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

// Log pool state periodically in production for observability.
let poolLogTimer = null;
if (process.env.NODE_ENV === "production") {
  poolLogTimer = setInterval(() => {
    console.log(
      `[db] pool — total:${pool.totalCount} idle:${pool.idleCount} waiting:${pool.waitingCount}`,
    );
  }, 60_000);
  poolLogTimer.unref();
}

// Make pool.end() idempotent so a double close (e.g. two test files sharing
// the pool) never throws "Cannot use a pool after calling end".
let poolEnded = false;
const endPool = pool.end.bind(pool);
pool.end = () => {
  if (poolEnded) return Promise.resolve();
  poolEnded = true;
  if (poolLogTimer) clearInterval(poolLogTimer);
  return endPool();
};

export default pool;
