-- M3 follow-up — Exercise search via Postgres FTS.
-- Replaces the ilike substring path with a proper tsvector + GIN index on
-- `exercises`, plus a pg_trgm GIN index on `name` for typo-tolerant fuzzy
-- fallback. See specs/03-exercise-library/POSTGRES_FTS_INVESTIGATION.md.
--
-- Idempotent: every statement uses IF NOT EXISTS / OR REPLACE so re-running
-- on a partially-applied schema is a no-op.
--
-- Weighting: name=A (highest), description=B, instructions=C. ts_rank
-- defaults — {A=1.0, B=0.4, C=0.2, D=0.1} — give the right ordering without
-- bespoke weight tuning at the query layer.

-- 1. pg_trgm extension for fuzzy-fallback (typo tolerance).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Generated stored tsvector column. STORED (not VIRTUAL) so the GIN
--    index below can use it. `coalesce` on each source field — without it,
--    a NULL description makes the entire concatenation NULL and the row
--    drops out of every search.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(instructions, '')), 'C')
  ) STORED;

-- 3. GIN index on the tsvector — drives the @@ match operator on the
--    search endpoint's primary path.
CREATE INDEX IF NOT EXISTS exercises_search_vector_idx
  ON exercises USING gin (search_vector);

-- 4. Trigram GIN index on `name` — drives word_similarity (%>) for the
--    typo-tolerant fallback when the tsvector path misses. Kept on name
--    only (not description/instructions) because the typo-fallback brief
--    is "find the exercise by its name even when mistyped"; broadening to
--    description would flood results with weak matches from instruction
--    prose.
CREATE INDEX IF NOT EXISTS exercises_name_trgm_idx
  ON exercises USING gin (name gin_trgm_ops);
