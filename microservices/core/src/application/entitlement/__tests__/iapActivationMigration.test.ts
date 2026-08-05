import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION = "20260805180000_activate_iap_coach_ladder.sql";

function findMigration(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, "supabase/migrations", MIGRATION);
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error(`Could not locate ${MIGRATION}`);
}

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("IAP ladder activation migration", () => {
  const sql = stripComments(readFileSync(findMigration(), "utf8"));

  it("activates exactly the six IAP paid tiers", () => {
    expect(sql).toContain("SET is_active = true");
    for (const tier of [
      "premium",
      "premium_plus",
      "individual_trainer",
      "start_up_coach_plus",
      "coach",
      "coach_pro",
    ]) {
      expect(sql).toContain(`'${tier}'`);
    }
    expect(sql).not.toContain("'small_business'");
    expect(sql).not.toContain("'medium_enterprise'");
  });

  it("applies ASC's supported Start Up Coach + annual price", () => {
    expect(sql).toMatch(/WHEN tier_name = 'start_up_coach_plus' THEN 289\.99/);
  });
});
