-- Loadout (spec-21) Phase 0 — `equipment_types.category`.
--
-- AC-2.2 requires the manual equipment picker to be grouped by category driven
-- BY THE API, not by a hardcoded client-side list. `equipment_types` has no
-- category column today (`id, name, description, created_at`) — the sibling
-- reference tables `accessibility_tags` and `goal_types` both do.
--
-- This lands in Phase 0 rather than Phase 2 (where the picker is built) because
-- deferring it would force an out-of-phase migration after the Phase-0
-- migration window has closed.
--
-- ⚠ SIX groups, not the five named in design § 2.3b. Brad, 2026-07-26. The five
-- (free weights / machines / cables / bodyweight / cardio) leave Resistance
-- Bands, Battle Ropes, Sled, Foam Roller, Yoga Mat and Box / Step with nowhere
-- to go — and bands are the single most important item in the set, since
-- "bands only" is one of Loadout's four canonical equipment contexts
-- (requirements § Eval spike E2 method). `accessories` is the sixth. design.md
-- § 2.3b is updated to match in the same commit.
--
-- Idempotent in both directions:
--   - ADD COLUMN IF NOT EXISTS.
--   - The backfill is `WHERE category IS NULL AND name IN (…)`, so a re-run is
--     a no-op AND a hand-recategorised row is never stomped back.
--
-- Nullable on purpose. An uncategorised row (a future seed addition, or a row
-- inserted by a customer-specific seed) renders under "Other" in the picker
-- rather than disappearing from it.

ALTER TABLE equipment_types
  ADD COLUMN IF NOT EXISTS category text;

-- Backfill the 28 rows seeded from `packages/seed/data/reference.json`.
-- Grouped the way a gym-goer would read a picker, not the way a taxonomist
-- would: the bench and the squat rack sit with the free weights because that is
-- the kit you use them WITH.

UPDATE equipment_types SET category = 'free_weights'
WHERE category IS NULL AND name IN (
  'Barbell', 'Dumbbells', 'Kettlebell', 'EZ Bar', 'Medicine Ball',
  'Bench', 'Squat Rack'
);

UPDATE equipment_types SET category = 'machines'
WHERE category IS NULL AND name IN (
  'Smith Machine', 'Leg Press Machine', 'Leg Curl Machine',
  'Leg Extension Machine'
);

UPDATE equipment_types SET category = 'cables'
WHERE category IS NULL AND name IN (
  'Cable Machine', 'Lat Pulldown Machine'
);

UPDATE equipment_types SET category = 'bodyweight'
WHERE category IS NULL AND name IN (
  'Bodyweight', 'Pull-up Bar', 'Dip Station', 'TRX / Suspension Trainer',
  'Ab Wheel'
);

UPDATE equipment_types SET category = 'cardio'
WHERE category IS NULL AND name IN (
  'Rowing Machine', 'Treadmill', 'Exercise Bike', 'Elliptical'
);

UPDATE equipment_types SET category = 'accessories'
WHERE category IS NULL AND name IN (
  'Resistance Bands', 'Foam Roller', 'Yoga Mat', 'Box / Step',
  'Battle Ropes', 'Sled'
);

COMMENT ON COLUMN equipment_types.category IS 'Loadout (spec-21): picker grouping — free_weights | machines | cables | bodyweight | cardio | accessories. Nullable; an uncategorised row renders under "Other" (AC-2.2).';
