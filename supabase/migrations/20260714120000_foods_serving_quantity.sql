-- Barcode serving-size fix — foods.serving_quantity.
--
-- Open Food Facts publishes a real per-serving size (`serving_quantity`, grams)
-- alongside the per-100g nutriments. We were requesting it but never storing it
-- and hardcoding serving_size=100, so the scan sheet's "Serving" tab could only
-- ever mean 100 g instead of the real pack serving (e.g. 220 g).
--
-- Macros stay stored per-100g (serving_size=100); serving_quantity is a separate
-- display/scale multiplier the mobile "Serving" tab uses to mean the real pack.
--
-- Nullable, no default: OFF frequently omits it, and the ~143k already-seeded
-- rows have no serving_quantity data (they were ingested before this column
-- existed). Those rows stay NULL and the "Serving" tab falls back to serving_size
-- (unchanged behaviour) until a re-seed / delta refresh re-ingests them from OFF.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS serving_quantity numeric;
