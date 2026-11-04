/**
 * Content assertions for `20261102120000_ai_monthly_budget.sql`. CI never runs
 * SQL, so this is what catches a dropped `IF NOT EXISTS`, a NOT NULL default
 * that would hand every retired tier a budget, or a paid tier left without one.
 * Assertions run against the COMMENT-STRIPPED SQL so rationale prose that quotes
 * a clause cannot make a test pass on its own.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "20261102120000_ai_monthly_budget.sql";

function loadStripped(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = resolve(dir, "supabase/migrations", NAME);
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    }
    dir = resolve(dir, "..");
  }
  throw new Error(`Could not locate ${NAME}`);
}

const sql = loadStripped();

describe(NAME, () => {
  it("adds the budget column idempotently and nullable", () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS ai_monthly_budget_usd numeric\(8, 2\);/,
    );
    expect(sql).not.toMatch(/ai_monthly_budget_usd[^;]*(NOT NULL|DEFAULT)/);
  });

  it("gives every live AI-bearing tier a positive budget", () => {
    for (const tier of [
      "premium",
      "premium_plus",
      "individual_trainer",
      "start_up_coach_plus",
      "coach",
      "coach_pro",
    ]) {
      const m = sql.match(
        new RegExp(
          `SET ai_monthly_budget_usd = ([0-9.]+)\\s+WHERE tier_name = '${tier}';`,
        ),
      );
      expect(m, tier).not.toBeNull();
      expect(Number(m![1]), tier).toBeGreaterThan(0);
    }
  });

  it("gives the free tier a zero budget", () => {
    expect(sql).toMatch(
      /SET ai_monthly_budget_usd = 0\s+WHERE tier_name = 'free';/,
    );
  });
});
