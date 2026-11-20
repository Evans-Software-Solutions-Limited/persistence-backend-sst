-- Design D, migration 6 — the "your meals" and entries part only (PER-109, BE-D1).
--
-- Contract: Linear "Backend design D — One meal-plan model, your meals and
-- Mealprint" (parts "Your meals" and "Entries"). The meal-plan tables
-- (nutrition_plans*, shopping_list_plans, recipe attribution) are PER-118 and
-- deliberately NOT here.
--
-- 1. `user_meals` — a person's own named meals (N1b), as many as they like.
--    `log_slot` maps each meal onto the four old slots so older app bundles
--    still place every entry. The four defaults are seeded on first read by
--    `UserMealRepository`, idempotently, guarded by the partial unique index on
--    `(user_id, default_key)`.
-- 2. `nutrition_entries.user_meal_id` — `userMealId` in the API. ON DELETE SET
--    NULL: user meals are only ever archived, but an account delete cascades the
--    meal rows and must never fail on the entries that point at them.
-- 3. `nutrition_entries.source_plan_id`, `source_plan_meal_id` — provenance for
--    "used N days" / "plan meals logged this week" (PER-118). No FK: the plan
--    tables don't exist yet, and logged history must outlive a deleted plan.
-- 4. `nutrition_entries.client_request_id` — makes food logs replay-safe. The
--    1.2.0 sync queue ALREADY sends `Idempotency-Key` on every queued POST
--    /nutrition/entries, so once the core deploy reads it, a food log re-sent
--    after a lost response stops duplicating for 1.2.0 phones too.
--
-- Purely additive: new table, new NULLable columns, new indexes. No existing
-- column, CHECK or default changes, so every older app bundle is unaffected.
--
-- ⚠ MIGRATE BEFORE DEPLOY. Declaring these columns in packages/db/src/schema.ts
-- puts them in Drizzle's explicit SELECT list, so a core deploy that lands before
-- this migration fails every READ of nutrition_entries (Fuel, Home ring, streaks)
-- with 42703 — not just the new routes. Same release gate as
-- 20260727120100_client_request_id_idempotency.sql.
--
-- Re-runnable: IF NOT EXISTS throughout; the client_request_id indexes are
-- dropped then created so a re-run converges on the FULL shape (see below).

CREATE TABLE IF NOT EXISTS user_meals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name              text NOT NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  log_slot          text NOT NULL,
  -- Set only on the four seeded defaults ('breakfast' | 'lunch' | 'snack' |
  -- 'dinner'). Never changes after seeding, even if the meal is renamed or
  -- re-slotted, so seeding can never run twice for the same default.
  default_key       text,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  client_request_id text,
  CONSTRAINT user_meals_name_len_chk
    CHECK (char_length(name) BETWEEN 1 AND 40),
  CONSTRAINT user_meals_log_slot_chk
    CHECK (log_slot IN ('breakfast', 'lunch', 'snack', 'dinner')),
  CONSTRAINT user_meals_default_key_chk
    CHECK (default_key IS NULL OR default_key IN ('breakfast', 'lunch', 'snack', 'dinner')),
  CONSTRAINT user_meals_sort_order_chk
    CHECK (sort_order >= 0)
);

CREATE INDEX IF NOT EXISTS user_meals_user_sort_idx
  ON user_meals (user_id, sort_order);

-- One seeded default per key per user. Partial on purpose: custom meals have no
-- key. Seeding uses a target-less ON CONFLICT DO NOTHING, which Postgres matches
-- against ANY unique index, partial included — so the 42P10 trap described below
-- does not apply to this one.
CREATE UNIQUE INDEX IF NOT EXISTS user_meals_user_default_key_idx
  ON user_meals (user_id, default_key)
  WHERE default_key IS NOT NULL;

-- Service-role only, like every table added since 20260626104105: reached
-- through the core API (which filters by the JWT user), never PostgREST.
ALTER TABLE user_meals ENABLE ROW LEVEL SECURITY;

ALTER TABLE nutrition_entries
  ADD COLUMN IF NOT EXISTS user_meal_id uuid
    REFERENCES user_meals(id) ON DELETE SET NULL;
ALTER TABLE nutrition_entries
  ADD COLUMN IF NOT EXISTS source_plan_id uuid;
ALTER TABLE nutrition_entries
  ADD COLUMN IF NOT EXISTS source_plan_meal_id uuid;
ALTER TABLE nutrition_entries
  ADD COLUMN IF NOT EXISTS client_request_id text;

-- ⚠ FULL unique indexes, deliberately NOT partial. Drizzle's
-- `onConflictDoNothing({ target })` / `onConflictDoUpdate({ target })` emit no
-- index predicate, and Postgres cannot infer a partial index without one — it
-- raises 42P10 on every keyed insert. NULLs are DISTINCT in a unique index, so
-- the existing all-NULL rows never conflict anyway. Full reasoning in
-- 20260727120100_client_request_id_idempotency.sql.
--
-- Dropped first so a re-run converges on this SHAPE, not merely this NAME.
DROP INDEX IF EXISTS nutrition_entries_user_client_request_idx;
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_entries_user_client_request_idx
  ON nutrition_entries (user_id, client_request_id);

DROP INDEX IF EXISTS user_meals_user_client_request_idx;
CREATE UNIQUE INDEX IF NOT EXISTS user_meals_user_client_request_idx
  ON user_meals (user_id, client_request_id);

-- Grouping reads ("entries for this meal") for the Log screen and PER-118's
-- "used N days".
CREATE INDEX IF NOT EXISTS nutrition_entries_user_meal_idx
  ON nutrition_entries (user_meal_id)
  WHERE user_meal_id IS NOT NULL;
