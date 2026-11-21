-- PER-114 (BE-B1) — Backend design B, migration 2: nutrition target history
-- (Linear: "Backend design B — Adherence and the AI weekly summary", D1).
--
-- `nutrition_targets` is one row per user, overwritten in place, so nothing
-- records what the target WAS on an earlier day. Calorie adherence judges each
-- day against the target in force that day, so this adds an append-only
-- history:
--
--   * nutrition_target_history   — one row per change of the four macro values
--   * a trigger on nutrition_targets that writes it. Because it's a trigger,
--     writes from OLD app bundles (PUT /nutrition/targets, the coach
--     PUT …/nutrition/target, the PER-108 set-up section) record history with
--     no client or route change.
--   * a backfill: one row per existing target with effective_at = 'epoch', so
--     the current target keeps counting for earlier days (today's behaviour).
--
-- Target for a day = the latest row with effective_at <= the end of that day
-- in the athlete's profiles.timezone. With two coaches, the last write wins
-- and set_by_user_id records who it came from (Brad, 20 Nov).
--
-- Additive and idempotent: a new table, a new function and trigger, and a
-- backfill that skips any user who already has history. Re-running is a no-op.
-- Rollback: supabase/rollbacks/20261121000100_nutrition_target_history.sql
--
-- Service-role only (RLS on, no policies): read through the core API, which
-- authorizes explicitly. The trigger function is SECURITY DEFINER so a write
-- by any role still records its history row.

CREATE TABLE IF NOT EXISTS nutrition_target_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  daily_kcal      numeric NOT NULL,
  protein_g       numeric NOT NULL,
  carbs_g         numeric NOT NULL,
  fat_g           numeric NOT NULL,
  -- The athlete or a coach. Drives "Set by Ellie". Copied from
  -- nutrition_targets.set_by_user_id at the time of the write. SET NULL so an
  -- account purge of the coach never blocks on, or deletes, the athlete's
  -- history.
  set_by_user_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  effective_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nutrition_target_history_user_effective_idx
  ON nutrition_target_history (user_id, effective_at DESC);

ALTER TABLE nutrition_target_history ENABLE ROW LEVEL SECURITY;

-- ─── Trigger ─────────────────────────────────────────────────────────────────
-- Fires on INSERT, and on UPDATE OF the four macro columns. An UPDATE that
-- lists them but leaves every value as it was (both upserts always SET all
-- four) writes nothing, so re-saving the same target isn't a "change".
-- water_cups, preset, set_by_user_id or updated_at alone never fire it.
CREATE OR REPLACE FUNCTION record_nutrition_target_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.daily_kcal IS NOT DISTINCT FROM OLD.daily_kcal
     AND NEW.protein_g  IS NOT DISTINCT FROM OLD.protein_g
     AND NEW.carbs_g    IS NOT DISTINCT FROM OLD.carbs_g
     AND NEW.fat_g      IS NOT DISTINCT FROM OLD.fat_g THEN
    RETURN NULL;
  END IF;

  INSERT INTO nutrition_target_history
    (user_id, daily_kcal, protein_g, carbs_g, fat_g, set_by_user_id, effective_at)
  VALUES
    (NEW.user_id, NEW.daily_kcal, NEW.protein_g, NEW.carbs_g, NEW.fat_g,
     NEW.set_by_user_id, now());
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS nutrition_targets_record_history ON nutrition_targets;
CREATE TRIGGER nutrition_targets_record_history
  AFTER INSERT OR UPDATE OF daily_kcal, protein_g, carbs_g, fat_g
  ON nutrition_targets
  FOR EACH ROW EXECUTE FUNCTION record_nutrition_target_history();

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- One 'epoch' row per existing target, so the current target is in force for
-- every earlier day. Skips a user who already has ANY history row, so a re-run
-- (or a user whose target was written after the trigger existed) is untouched.
INSERT INTO nutrition_target_history
  (user_id, daily_kcal, protein_g, carbs_g, fat_g, set_by_user_id, effective_at)
SELECT t.user_id, t.daily_kcal, t.protein_g, t.carbs_g, t.fat_g,
       t.set_by_user_id, 'epoch'::timestamptz
FROM nutrition_targets t
WHERE NOT EXISTS (
  SELECT 1 FROM nutrition_target_history h WHERE h.user_id = t.user_id
);
