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
