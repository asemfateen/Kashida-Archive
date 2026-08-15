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
