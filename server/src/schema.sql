-- Fuzzy tag search relies on pg_trgm (similarity/word_similarity operators).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key VARCHAR(512) NOT NULL UNIQUE,
  original_filename VARCHAR(512) NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(tags, ''))) STORED
);

CREATE INDEX IF NOT EXISTS images_search_vector_idx ON images USING GIN (search_vector);

ALTER TABLE images ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE images ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE images ADD COLUMN IF NOT EXISTS ai_tagged BOOLEAN NOT NULL DEFAULT false;

-- search_vector must be added via ALTER for pre-existing databases, not only in
-- the CREATE TABLE. Adding the column then the index is idempotent on both.
ALTER TABLE images ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(tags, ''))) STORED;
CREATE INDEX IF NOT EXISTS images_search_vector_idx ON images USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS images_active_created_idx ON images (created_at DESC) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS images_favorites_idx ON images (created_at DESC) WHERE deleted = false AND favorite;
CREATE INDEX IF NOT EXISTS images_deleted_idx ON images (created_at DESC) WHERE deleted = true;

-- Trigram index so tags ILIKE '%term%' and similarity() stay fast. gin_trgm_ops
-- covers both the % similarity operator and word_similarity().
CREATE INDEX IF NOT EXISTS images_tags_trgm_idx ON images USING GIN (tags gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- AI queue + rate-limit memory
-- ---------------------------------------------------------------------------
-- Every AI-tagging request becomes a row here. A background worker drains the
-- queue one job at a time, pacing calls so Gemini's free-tier quota is never
-- hammered, and retrying after rate-limit cooldowns. Survives restarts.
CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key VARCHAR(512) NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'canceled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  result_tags TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_jobs_status_idx ON ai_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_jobs_object_key_idx ON ai_jobs (object_key);

-- Key/value store for persistent AI system state:
--   config -> { master_prompt, min_interval_ms, daily_limit }
--   quota  -> { date, count, rateLimitedAt, retryAfterMs, rateLimitedUntil, lastError }
--   paused -> boolean
-- The 1-hour freshness rule lives here: the rate-limited pause only applies
-- while a rate-limit sighting is under an hour old.
CREATE TABLE IF NOT EXISTS ai_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
