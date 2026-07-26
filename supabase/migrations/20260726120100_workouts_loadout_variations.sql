-- Loadout (spec-21) Phase 0 — parent ↔ variation linkage on `workouts`.
--
-- A Loadout run never mutates the workout it adapts (AC-1.3). It writes a NEW
-- workout owned by the CALLER, pointing back at the parent. The parent's own
-- row and `workout_exercises` are untouched, so a variation is additive by
-- construction rather than by discipline.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and the
-- CHECK is added inside a pg_constraint existence guard — a bare
-- `ALTER TABLE … ADD CONSTRAINT` is NOT idempotent and fails on re-run.
-- Guard pattern: `20260703120000_programs_unified_model.sql`.

ALTER TABLE workouts
  -- Self-referential parent. NULL = an ordinary top-level workout, which is
  -- every row that exists today.
  --
  -- ON DELETE SET NULL is deliberate, and load-bearing with the library
  -- predicate below. Deleting a parent turns its variations into ordinary
  -- standalone workouts that reappear in the owner's library — they are never
  -- silently destroyed (AC-5.4), and no cleanup job is needed. CASCADE would
  -- delete a training history's worth of variations behind one tap; RESTRICT
  -- would make any adapted workout undeletable.
  ADD COLUMN IF NOT EXISTS parent_workout_id uuid
    REFERENCES workouts(id) ON DELETE SET NULL,
  -- What KIND of variation this is. Constrained below rather than left free
  -- text, so a future variation kind is a reviewed migration, not a typo.
  ADD COLUMN IF NOT EXISTS variation_kind text,
  -- The saved gym this was adapted for, when one was used. NULL for an ad-hoc
  -- equipment context. SET NULL on delete: deleting a gym must not delete the
  -- variations built from it (AC-7.3).
  ADD COLUMN IF NOT EXISTS source_gym_id uuid
    REFERENCES saved_gyms(id) ON DELETE SET NULL,
  -- FROZEN SNAPSHOT of the equipment context, not a join. A saved gym can be
  -- renamed, re-kitted or deleted; the variation must still be able to say what
  -- kit it was built for (AC-5.2 / AC-7.3). This is why it coexists with
  -- source_gym_id rather than being derived from it.
  ADD COLUMN IF NOT EXISTS source_equipment_type_ids uuid[];

-- Partial: only variations carry a parent, and they are a small minority of
-- rows. Backs `GET /workouts/:id/variations` and the `parent_workout_id IS
-- NULL` library predicate.
CREATE INDEX IF NOT EXISTS workouts_parent_idx
  ON workouts (parent_workout_id) WHERE parent_workout_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workouts_variation_kind_check'
  ) THEN
    ALTER TABLE workouts ADD CONSTRAINT workouts_variation_kind_check
      CHECK (variation_kind IS NULL OR variation_kind IN ('loadout'));
  END IF;
END $$;

COMMENT ON COLUMN workouts.parent_workout_id IS 'Loadout (spec-21): the workout this row is a variation OF. NULL for ordinary workouts. ON DELETE SET NULL — deleting a parent promotes its variations to standalone workouts rather than destroying them (design § 2.2).';
COMMENT ON COLUMN workouts.source_equipment_type_ids IS 'Loadout (spec-21): frozen snapshot of the equipment context this variation was adapted for. Deliberately NOT derived from source_gym_id, which can be renamed, re-kitted or deleted.';
