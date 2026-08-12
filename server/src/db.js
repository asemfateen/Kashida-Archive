import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://smart_archive:smart_archive@localhost:5432/smart_image_archive",
});

export default pool;
