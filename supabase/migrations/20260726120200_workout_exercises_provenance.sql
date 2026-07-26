-- Loadout (spec-21) Phase 0 — per-row swap provenance on `workout_exercises`.
--
-- A Loadout variation has to be able to explain itself two weeks later: which
-- exercise this row replaced, and why. Recomputing that by diffing against the
-- parent at read time breaks the moment either side is hand-edited, so the
-- provenance is persisted with the row (AC-3.3).
--
-- Swap COUNT is deliberately NOT stored — it is derived
-- (`count(substituted_from_exercise_id)`), so it can never drift from the rows
-- it describes.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS throughout.

ALTER TABLE workout_exercises
  -- The exercise this row replaced. NULL = not a swap (a KEPT row, or any
  -- ordinary non-Loadout workout row — i.e. every row that exists today).
  -- SET NULL rather than CASCADE: deleting the exercise that was swapped OUT
  -- must not delete the row that replaced it.
  ADD COLUMN IF NOT EXISTS substituted_from_exercise_id uuid
    REFERENCES exercises(id) ON DELETE SET NULL,
  -- jsonb, NOT text. The reason is a STRUCTURED, localisable code —
  -- `{ code, missingEquipment, matchedOn }` (design § 7.2) — because the mobile
  -- layer renders the copy from the code and the backend stays free of UI
  -- strings. A text column would force JSON-in-string.
  ADD COLUMN IF NOT EXISTS substitution_reason jsonb,
  -- The athlete deliberately picked this row themselves, after an explicit
  -- "doesn't fit your kit" acknowledgement (AC-4.3). This is what lets the save
  -- path skip equipment-containment re-verification for THIS row without
  -- weakening the check everywhere else (design § 7.1).
  --
  -- ⚠ On the create path this is a CLIENT-SUPPLIED CLAIM — the row does not
  -- exist yet. That is acceptable only because containment is a QUALITY check;
  -- read-visibility, the actual security control, is re-verified on every row
  -- regardless. Do not later reuse this flag as a server-attested fact for a
  -- gate where it would matter.
  ADD COLUMN IF NOT EXISTS is_user_override boolean NOT NULL DEFAULT false;

-- NO NEW INDEX, deliberately. `001_initial_schema.sql:699-702` already creates
-- `idx_workout_exercises_workout`, `idx_workout_exercises_workout_id` (an
-- already-redundant pair on the same column) and a composite
-- `(workout_id, superset_group)`. `CREATE INDEX IF NOT EXISTS` matches on NAME,
-- not definition, so a differently-named index on the same column would
-- silently become a THIRD duplicate on a hot write path. The existing indexes
-- are mirrored into schema.ts instead; tidying the redundant pair is out of
-- scope for this spec.

COMMENT ON COLUMN workout_exercises.substituted_from_exercise_id IS 'Loadout (spec-21): the exercise this row replaced. NULL = not a swap. Swap count is derived from this column, never stored.';
COMMENT ON COLUMN workout_exercises.substitution_reason IS 'Loadout (spec-21): structured reason code { code, missingEquipment, matchedOn } (design § 7.2). jsonb so the code stays machine-readable and the copy stays in the mobile layer.';
COMMENT ON COLUMN workout_exercises.is_user_override IS 'Loadout (spec-21): the user deliberately chose this exercise (AC-4.3). Client-supplied on create — a quality signal, never a security fact (design § 7.1).';
