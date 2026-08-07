-- OFF nutrition trust boundary.
--
-- Keep contradictory source rows for audit and later refresh, but make every
-- application read fail closed. The default preserves existing user-created
-- foods; OFF rows are quarantined below when their kcal value is grossly
-- incompatible with their declared macros.
ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS nutrition_data_valid boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS nutrition_data_issue text;

COMMENT ON COLUMN foods.nutrition_data_valid IS
  'False when external nutrition values are contradictory; excluded from all user-facing reads.';
COMMENT ON COLUMN foods.nutrition_data_issue IS
  'Machine-readable quarantine reason: off_quality_flag, energy_mismatch, or macro_energy_mismatch.';

-- A deliberately conservative lower-bound check. Exact 4/4/9 agreement is not
-- required because fibre, polyols, alcohol and label rounding affect energy.
-- Values below 10% of declared protein/carbohydrate/fat energy are not credible.
UPDATE foods
SET nutrition_data_valid = false,
    nutrition_data_issue = 'macro_energy_mismatch'
WHERE source = 'openfoodfacts'
  AND (protein_g * 4 + carbs_g * 4 + fat_g * 9) > 0
  AND kcal < (protein_g * 4 + carbs_g * 4 + fat_g * 9) * 0.10;

-- These three rows are the staging incident that exposed the mapper defect.
-- OFF's kcal field contradicted both its kJ field and declared macros. Store the
-- kJ-derived value for truthful audit/history while keeping the product
-- quarantined until OFF publishes internally consistent data.
WITH corrections(barcode, corrected_kcal) AS (
  VALUES
    ('01851960'::text, 203.3::numeric),
    ('5018605966459'::text, 357.1::numeric),
    ('9555387101471'::text, 291.7::numeric)
)
UPDATE foods AS f
SET kcal = c.corrected_kcal,
    nutrition_data_valid = false,
    nutrition_data_issue = 'energy_mismatch'
FROM corrections AS c
WHERE f.source = 'openfoodfacts'
  AND f.barcode = c.barcode;

-- Nutrition entries denormalise macros. Repair already-logged instances of the
-- affected products so diary history no longer shows 41 kcal for the meal.
WITH corrections(barcode, corrected_kcal) AS (
  VALUES
    ('01851960'::text, 203.3::numeric),
    ('5018605966459'::text, 357.1::numeric),
    ('9555387101471'::text, 291.7::numeric)
)
UPDATE nutrition_entries AS ne
SET kcal = round(c.corrected_kcal * ne.servings, 1)
FROM foods AS f
JOIN corrections AS c ON c.barcode = f.barcode
WHERE ne.food_id = f.id
  AND f.source = 'openfoodfacts';
