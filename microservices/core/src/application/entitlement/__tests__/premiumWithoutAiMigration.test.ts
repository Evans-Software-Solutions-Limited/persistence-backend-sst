/**
 * Content assertions for `20261106120000_premium_without_ai.sql` (PER-103).
 * CI never runs SQL, so this is what catches Premium keeping AI, a transposed
 * price, a budget that would let Premium spend, or a statement that is not
 * safe to re-run. Assertions run against the COMMENT-STRIPPED SQL so the
 * rationale prose (which quotes the same numbers) cannot satisfy them.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "20261106120000_premium_without_ai.sql";

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

/** The single UPDATE statement whose WHERE clause names `tier`. */
function updateFor(tier: string): string {
  const statements = sql
    .split(";")
    .filter((s) => s.includes(`WHERE tier_name = '${tier}'`));
  expect(statements, tier).toHaveLength(1);
  return statements[0]!;
}

function setValue(statement: string, column: string): string | null {
  const m = statement.match(new RegExp(`${column}\\s*=\\s*([^,\\n]+)`));
  return m ? m[1]!.trim() : null;
}

describe(NAME, () => {
  it("takes AI away from Premium and gives it a zero budget", () => {
    const premium = updateFor("premium");
    expect(setValue(premium, "ai_access")).toBe("false");
    expect(setValue(premium, "ai_monthly_budget_usd")).toBe("0");
  });

  it("prices Premium at £4.99 / £39.99", () => {
    const premium = updateFor("premium");
    expect(setValue(premium, "price_monthly")).toBe("4.99");
    expect(setValue(premium, "price_yearly")).toBe("39.99");
  });

  it("prices Premium+ at £24.99 / £199.99 with a $4.89 budget", () => {
    const plus = updateFor("premium_plus");
    expect(setValue(plus, "price_monthly")).toBe("24.99");
    expect(setValue(plus, "price_yearly")).toBe("199.99");
    expect(setValue(plus, "ai_monthly_budget_usd")).toBe("4.89");
  });

  it("leaves Premium+ AI and suite flags untouched", () => {
    const plus = updateFor("premium_plus");
    expect(plus).not.toMatch(/ai_access|loadout_access|mealprint_access/);
  });

  it("never renames a tier and touches no other tier", () => {
    expect(sql).not.toMatch(/SET(?:(?!WHERE)[^;])*\btier_name\s*=/);
    const tiers = [...sql.matchAll(/WHERE tier_name = '([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(tiers.sort()).toEqual(["premium", "premium_plus"]);
  });

  it("drops the AI claim from Premium's description", () => {
    const description = setValue(updateFor("premium"), "description");
    expect(description).not.toBeNull();
    expect(description).not.toMatch(/\bAI\b/);
  });

  it("is a plain re-runnable UPDATE (no inserts, no deletes, no DDL)", () => {
    expect(sql).not.toMatch(/\b(INSERT|DELETE|ALTER|DROP|CREATE)\b/i);
  });
});
