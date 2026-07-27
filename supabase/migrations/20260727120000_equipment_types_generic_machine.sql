-- Generic `Machine` equipment type.
--
-- The mobile create/edit-exercise form offers exactly seven equipment options
-- (Barbell, Dumbbell, Machine, Cable, Bodyweight, Kettlebell, Band), but the
-- seeded catalogue held only SPECIFIC machines — `Smith Machine`,
-- `Leg Press Machine`, `Leg Curl Machine`, `Leg Extension Machine`,
-- `Cable Machine`, `Lat Pulldown Machine`, `Rowing Machine`. So the form's
-- `Machine` option had no row to resolve to, and a custom exercise saved with it
-- could not be represented at all.
--
-- Brad's call, 2026-07-27: add the generic row rather than force the user to
-- name a specific machine on an exercise they are creating by hand.
--
-- Paired with `EQUIPMENT_CATALOGUE_NAME` in
-- `packages/mobile/src/domain/services/exerciseCatalogue.ts`, which maps the
-- `machine` enum member to this exact name. The name is the join key — renaming
-- this row breaks that mapping, so change both together.
--
-- ⚠ This row becomes selectable in Loadout's manual equipment picker and can be
-- returned by the equipment scan's membership validation, since both read the
-- whole `equipment_types` table. That is intended — a user whose gym has "some
-- machine" should be able to say so — but it does mean the picker now shows a
-- generic option alongside the specific ones. Categorised as `machines` so it
-- groups with them rather than falling into the picker's "Other" bucket.
--
-- Idempotent: `equipment_types.name` is UNIQUE (001_initial_schema.sql), so
-- ON CONFLICT DO NOTHING makes a re-run a no-op. Purely additive — safe under
-- the migrate-then-deploy ordering (no expand/contract needed).

-- ⚠ Deliberately does NOT write `description`, even though 001_initial_schema.sql
-- declares the column. The live Supabase table has drifted from that migration:
-- `exerciseRepository.getEquipmentTypes` projects columns explicitly *because*
-- `description` "does not exist in the live DB" (see its docstring, and the
-- standing note in STATE.md). Naming it here would fail the migration — and
-- production migrations run BEFORE `sst deploy`, so a failure blocks the whole
-- release. `name` and `category` are the two columns proven present on the live
-- table (`category` is added by 20260726120300, which sorts earlier and so has
-- already run).
INSERT INTO equipment_types (name, category)
VALUES ('Machine', 'machines')
ON CONFLICT (name) DO NOTHING;

-- Backfill the category if the row somehow pre-exists without one (e.g. a hand
-- inserted row on a dev stage). Scoped to NULL so it never overwrites a
-- deliberate recategorisation.
UPDATE equipment_types
SET category = 'machines'
WHERE name = 'Machine' AND category IS NULL;
