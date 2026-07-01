-- Split the combined `preferred_units` ('metric'|'imperial') preference into
-- two independent per-field preferences: users routinely mix units (e.g. kg
-- for weight, ft/in for height, common in the UK) — a single metric/imperial
-- toggle can't express that combination.
--
-- `preferred_units` is left in place but unused going forward: it's already
-- part of the deployed schema and `dashboardRepository.getDashboard` still
-- projects it on the wire, but nothing in the mobile client actually reads
-- that copy (confirmed before this migration) — no live feature depends on
-- its combined semantics, so no backfill/data-migration is needed. It can be
-- dropped in a later cleanup migration once the dashboard payload shape is
-- revisited.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded CHECK constraints so a
-- re-run is a no-op.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS weight_unit text DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS height_unit text DEFAULT 'cm';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_weight_unit_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_weight_unit_check
      CHECK (weight_unit IN ('kg', 'lb'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_height_unit_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_height_unit_check
      CHECK (height_unit IN ('cm', 'ftin'));
  END IF;
END $$;
