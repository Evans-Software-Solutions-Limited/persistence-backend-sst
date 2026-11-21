import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

/**
 * A real Postgres (PGlite) carrying the actual nutrition DDL, for the Design D
 * (PER-109) integration tests. The repository unit suites mock `getDb`, so
 * nothing there can prove an ON CONFLICT matches an index, a CHECK fires, or a
 * replay really leaves one row. These tests run the shipped migration files.
 */

export const USER_A = "00000000-0000-4000-8000-00000000000a";
export const USER_B = "00000000-0000-4000-8000-00000000000b";

export const migrationSql = (dir: "migrations" | "rollbacks", file: string) =>
  readFileSync(
    new URL(`../../../../../../supabase/${dir}/${file}`, import.meta.url),
    "utf8",
  );

/** The migrations that build `nutrition_entries` and `foods` as production has them today. */
export const BASE_NUTRITION_MIGRATIONS = [
  "20260621120000_m9_nutrition_schema.sql",
  "20260708120000_nutrition_entries_custom_name.sql",
  // The later `foods` columns FoodRepository selects.
  "20260714120000_foods_serving_quantity.sql",
  "20260803120000_foods_mealprint_tags.sql",
  "20260807185359_off_energy_trust_boundary.sql",
];

export const YOUR_MEALS_MIGRATION =
  "20261120143109_your_meals_entry_idempotency.sql";

export const MEAL_PLANS_MIGRATION =
  "20261121000118_meal_plans_coach_assignments.sql";

/**
 * PER-118's migration, plus the few objects it builds on that this nutrition-only
 * schema lacks (stand-ins only). Without it the Drizzle mirror's recipe columns
 * (`source_recipe_id`, `shared_by_user_id`) 42703 every recipe read, exactly as
 * production would if core deployed before the migration.
 */
export async function applyMealPlansMigration(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS pt_client_relationships (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('coach_brief');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE action_type_enum AS ENUM ('brief_sent');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await pg.exec(
    migrationSql("migrations", "20260804120000_mealprint_plans.sql"),
  );
  await pg.exec(migrationSql("migrations", MEAL_PLANS_MIGRATION));
}

/**
 * Drop and rebuild `public` (one PGlite per file — a fresh instance per test
 * doesn't give its WASM memory back; see voucher.integration.test.ts), then
 * apply the base nutrition schema and, unless told not to, migration 6.
 */
export async function resetNutritionSchema(
  pg: PGlite,
  opts: { withYourMeals?: boolean } = {},
): Promise<void> {
  await pg.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pg.exec(`
    CREATE TABLE profiles (id uuid PRIMARY KEY, timezone text, full_name text);
    INSERT INTO profiles (id, timezone) VALUES
      ('${USER_A}', 'Europe/London'),
      ('${USER_B}', 'Europe/London');
  `);
  for (const file of BASE_NUTRITION_MIGRATIONS) {
    await pg.exec(migrationSql("migrations", file));
  }
  if (opts.withYourMeals ?? true) {
    await pg.exec(migrationSql("migrations", YOUR_MEALS_MIGRATION));
    await applyMealPlansMigration(pg);
  }
}
