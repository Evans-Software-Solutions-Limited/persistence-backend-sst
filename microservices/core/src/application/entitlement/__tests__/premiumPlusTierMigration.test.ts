import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// M19-P0 (spec-21 § 9.1) seeds the `premium_plus` catalog row. CI never
// executes SQL, so nothing else in this repo would catch a transposed price,
// a wrong flag, or an accidentally-active row — every other check in that
// change is TypeScript-side. This locks the values that carry money or
// user-visible behaviour, mirroring the `subscriptionTierSeed.test.ts`
// precedent of asserting against the migration text itself.
//
// Two of these are load-bearing beyond "is the number right":
//   * is_active MUST be false. `SubscriptionTiersRepository.listActive()`
//     filters on it and both paywalls now render every active non-trainer
//     row, so flipping it true publishes a buyable £29.99/mo card selling a
//     tier whose differentiator (Loadout + Mealprint) does not exist yet.
//     Launch flips it in its own migration.
//   * ai_workout_limit is rendered directly into paywall copy
//     ("N AI workouts per month"), so it is display data, not just config.

const MIGRATION = "20260725194527_premium_plus_tier.sql";

function findMigration(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, "supabase/migrations", MIGRATION);
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error(`Could not locate ${MIGRATION}`);
}

/**
 * The VALUES tuple, stripped of the SQL comment block above it so comment
 * prose (which mentions £29.99, "is_active", etc.) can never satisfy an
 * assertion about the actual row.
 */
function valuesTuple(sql: string): string {
  const start = sql.indexOf(") VALUES (");
  const end = sql.indexOf("ON CONFLICT", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

describe("premium_plus tier migration", () => {
  const sql = readFileSync(findMigration(), "utf8");
  const tuple = valuesTuple(sql);

  it("inserts the premium_plus row idempotently", () => {
    expect(sql).toContain("INSERT INTO subscription_tiers");
    expect(sql).toContain("ON CONFLICT (tier_name) DO NOTHING");
    expect(tuple).toContain("'premium_plus'");
    expect(tuple).toContain("'Premium+'");
  });

  it("is priced at £29.99 / £299.99 GBP", () => {
    expect(tuple).toMatch(/\n\s*29\.99,\s*299\.99,\s*'GBP',/);
  });

  it("is seeded INACTIVE so it is not purchasable before Loadout ships", () => {
    // Last field of the tuple, immediately before the closing paren.
    expect(tuple).toMatch(/true,\s*true,\s*false\s*\n?\)/);
    expect(tuple).not.toMatch(/true,\s*true,\s*true\s*\n?\)/);
  });

  it("is a consumer tier with unlimited workouts and 30 AI workouts", () => {
    // `NULL, true, 30, …` = workout_limit, ai_access, ai_workout_limit.
    expect(tuple).toMatch(/\n\s*NULL,\s*true,\s*30,/);
    // `NULL, false,` = trainer_client_limit, is_trainer_tier.
    expect(tuple).toMatch(/\n\s*NULL,\s*false,/);
  });

  it("advertises the adaptive suite in the features JSONB", () => {
    // The paywall renders these two keys as the tier's selling points.
    expect(tuple).toContain('"loadout": true');
    expect(tuple).toContain('"mealprint": true');
    expect(tuple).toContain('"ai_workouts": 30');
  });

  it("adds loadout_access and grants it to Premium+ and every trainer tier", () => {
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS loadout_access boolean NOT NULL DEFAULT false",
    );
    const grant = sql.slice(sql.indexOf("SET loadout_access = true"));
    for (const tier of [
      "premium_plus",
      "individual_trainer",
      "small_business",
      "medium_enterprise",
    ]) {
      expect(grant).toContain(`'${tier}'`);
    }
    // Free and Premium must NOT be granted the adaptive suite.
    expect(grant).not.toContain("'free'");
    expect(grant).not.toMatch(/'premium'/);
  });
});
