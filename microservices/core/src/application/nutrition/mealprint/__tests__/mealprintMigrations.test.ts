/**
 * Mealprint (spec-26) Phase 0 — migration-content assertions.
 *
 * CI never executes SQL, and `supabase/migrations/**` is not even an input to
 * `@persistence/core#test:unit`'s Turbo cache — so without this file nothing in
 * the repo would catch a dropped `IF NOT EXISTS`, a vocabulary CHECK that has
 * drifted from `vocabulary.ts`, or the `mealprint_access` grant quietly
 * acquiring the trainer tiers. Same precedent and same reasoning as
 * `premiumPlusTierMigration.test.ts`.
 *
 * ⚠ Every assertion runs against the COMMENT-STRIPPED SQL. These files carry
 * long rationale blocks that quote the very clauses under test, so asserting
 * against the raw text would pass on prose even if the real statement were
 * deleted — the exact trap the premium_plus test documents.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  AVOID_ALLERGENS,
  DIETARY_PATTERNS,
  EFFORT_LEVELS,
} from "../preferences/vocabulary";

function findMigration(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 12; i++) {
    const candidate = resolve(dir, "supabase/migrations", name);
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error(`Could not locate ${name}`);
}

function loadStripped(name: string): string {
  return readFileSync(findMigration(name), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("20260803120000_foods_mealprint_tags.sql", () => {
  const sql = loadStripped("20260803120000_foods_mealprint_tags.sql");

  it("adds all three tag columns idempotently", () => {
    for (const column of ["allergen_tags", "category_tags", "locale_tags"]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column} text[]`);
    }
  });

  it("leaves the tag columns NULLABLE with no default", () => {
    // ⚠ Load-bearing. `NOT NULL DEFAULT '{}'` would make every existing row read
    // as "verified to contain no allergens" the instant the migration applied —
    // turning ~144k un-analysed foods into positively-cleared ones for an
    // allergen-avoiding user. NULL is the unknown-and-therefore-unsafe encoding
    // `avoidanceFilter` depends on.
    expect(sql).not.toMatch(/allergen_tags text\[\][^;]*NOT NULL/);
    expect(sql).not.toMatch(/allergen_tags text\[\][^;]*DEFAULT/);
  });

  it("creates a GIN index per tag column, idempotently", () => {
    for (const column of ["allergen_tags", "category_tags", "locale_tags"]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE INDEX IF NOT EXISTS foods_${column}_gin\\s+ON foods USING gin \\(${column}\\)`,
        ),
      );
    }
  });

  it("does not use CONCURRENTLY, which cannot run inside a migration transaction", () => {
    expect(sql).not.toContain("CONCURRENTLY");
  });
});

describe("20260803120100_nutrition_preferences.sql", () => {
  const sql = loadStripped("20260803120100_nutrition_preferences.sql");

  it("creates both tables idempotently with RLS on", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS nutrition_preferences");
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS mealprint_ingredient_feedback",
    );
    // Backend-only tables: RLS on with zero policies closes them to PostgREST,
    // without which any authenticated user could read every other user's
    // dietary and allergen data.
    expect(sql).toContain(
      "ALTER TABLE nutrition_preferences ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "ALTER TABLE mealprint_ingredient_feedback ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).not.toContain("CREATE POLICY");
  });

  it("keys preferences on user_id so a user cannot have two rows", () => {
    expect(sql).toMatch(/user_id\s+uuid PRIMARY KEY REFERENCES profiles\(id\)/);
  });

  it("defaults every list column NOT NULL '{}' so no read has to coalesce", () => {
    for (const column of [
      "dietary_patterns",
      "avoid_allergens",
      "avoid_foods",
      "liked_foods",
    ]) {
      expect(sql).toMatch(
        new RegExp(`${column}\\s+text\\[\\] NOT NULL DEFAULT '\\{\\}'`),
      );
    }
  });

  // ⚠ THE DRIFT GUARD. A pattern or allergen key that exists in `vocabulary.ts`
  // but not in the CHECK (or the reverse) is how an unenforceable preference
  // gets stored — the user picks "vegan" and the filter has no rule, so they get
  // meat. These loops make that a test failure instead.
  it("CHECK-constrains dietary_patterns to exactly the code vocabulary", () => {
    const start = sql.indexOf("nutrition_preferences_patterns_known");
    const check = sql.slice(start, sql.indexOf("),", start));
    for (const pattern of DIETARY_PATTERNS) {
      expect(check, pattern).toContain(`'${pattern}'`);
    }
  });

  it("CHECK-constrains avoid_allergens to exactly the UK FIC 14 code vocabulary", () => {
    const start = sql.indexOf("nutrition_preferences_allergens_known");
    const check = sql.slice(start, sql.indexOf("),", start));
    expect(AVOID_ALLERGENS).toHaveLength(14);
    for (const allergen of AVOID_ALLERGENS) {
      expect(check, allergen).toContain(`'${allergen}'`);
    }
  });

  it("CHECK-constrains effort_level to the code vocabulary", () => {
    const start = sql.indexOf("nutrition_preferences_effort_known");
    const check = sql.slice(start, sql.indexOf(")", start));
    for (const level of EFFORT_LEVELS) {
      expect(check, level).toContain(`'${level}'`);
    }
  });

  it("bounds meals_per_day to 2..6 with a matching default", () => {
    expect(sql).toContain("meals_per_day BETWEEN 2 AND 6");
    expect(sql).toMatch(/meals_per_day\s+integer NOT NULL DEFAULT 4/);
  });

  it("requires a feedback row to identify something", () => {
    expect(sql).toContain("food_id IS NOT NULL OR custom_name IS NOT NULL");
  });

  it("cascades preferences on profile delete so account deletion stays clean", () => {
    // Account deletion (#214 / #336) is an App Store requirement; a preferences
    // row surviving its owner would block the profile delete on the FK.
    expect(sql).toMatch(
      /user_id\s+uuid PRIMARY KEY REFERENCES profiles\(id\) ON DELETE CASCADE/,
    );
  });
});

describe("20260803120200_mealprint_access.sql", () => {
  const sql = loadStripped("20260803120200_mealprint_access.sql");

  it("adds the column additively, defaulting to no access", () => {
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS mealprint_access boolean NOT NULL DEFAULT false",
    );
  });

  // ⚠ THE ASSERTION THAT ENCODES THE PRICING DECISION. `loadout_access` was
  // granted to all three trainer tiers, producing the known £14.99-vs-£29.99
  // price hole (STATE.md § Pricing vs AI cost). Mealprint deliberately does not
  // repeat it: no coach surface exists in v1, and `individual_trainer` is
  // already the most cost-exposed tier in the catalogue. If a future change
  // grants a trainer tier here, `pickUpgradeTier`'s PREMIUM_PLUS_ONLY_FEATURES
  // entry has to change with it — this test is the tripwire between the two.
  it("grants mealprint_access to premium_plus ONLY", () => {
    const start = sql.indexOf("SET mealprint_access = true");
    const grant = sql.slice(start, sql.indexOf(";", start));
    expect(grant).toContain("'premium_plus'");
    for (const tier of [
      "free",
      "individual_trainer",
      "small_business",
      "medium_enterprise",
    ]) {
      expect(grant, tier).not.toContain(`'${tier}'`);
    }
    // `'premium'` would be matched by `'premium_plus'` as a substring, so assert
    // the standalone quoted form.
    expect(grant).not.toMatch(/'premium'/);
  });

  it("does not activate the tier — T-P0.10 owns that flip", () => {
    expect(sql).not.toContain("is_active");
  });
});
