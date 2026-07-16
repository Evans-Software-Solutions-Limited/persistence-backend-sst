-- spec-12.13 — enforce one subscription row per external (store) subscription id.
-- Prevents duplicate grants from the non-atomic find->insert in the RevenueCat/Stripe
-- webhook paths, and unlocks INSERT ... ON CONFLICT (external_subscription_id) upserts.
--
-- Direct precedent for the pattern (plain CREATE, NOT CONCURRENTLY — migrations run
-- inside a transaction under `supabase db push` — idempotent DROP IF EXISTS + CREATE,
-- pre-flight dedup note): 20260605120000_widen_active_subscription_unique.sql.
--
-- ── PRE-FLIGHT (populated DBs — run against BOTH staging and prod BEFORE relying on
-- this; CREATE UNIQUE INDEX fails if any duplicate already exists). Must return zero
-- rows; if it returns rows, resolve them as a deliberate, reviewed data op — do NOT
-- auto-mutate billing rows as a DDL side effect: ──────────────────────────────────
--   SELECT external_subscription_id, count(*)
--   FROM user_subscriptions
--   WHERE external_subscription_id IS NOT NULL
--   GROUP BY external_subscription_id
--   HAVING count(*) > 1;

-- Replace the non-unique lookup index with a partial UNIQUE index. A unique index
-- still serves the equality lookups `findByExternalId` performs, so dropping the plain
-- lookup index loses nothing. The partial predicate is required: the column is nullable
-- (free-tier / legacy rows leave it NULL) and multiple NULLs must remain allowed; it
-- also mirrors the existing partial index's shape.
DROP INDEX IF EXISTS idx_user_subscriptions_external_id;
DROP INDEX IF EXISTS user_subscriptions_external_id_unique;
CREATE UNIQUE INDEX user_subscriptions_external_id_unique
  ON user_subscriptions (external_subscription_id)
  WHERE external_subscription_id IS NOT NULL;
COMMENT ON INDEX user_subscriptions_external_id_unique IS
  'spec-12.13: one row per store subscription id (partial, non-NULL). Enables idempotent upsert.';
