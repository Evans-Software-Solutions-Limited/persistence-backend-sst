import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION = "20260808093010_align_start_up_coach_client_cap.sql";

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

describe("Start Up Coach client-cap correction migration", () => {
  const sql = stripComments(readFileSync(findMigration(), "utf8"));

  it("aligns only individual_trainer's enforced and advertised client cap", () => {
    expect(sql).toMatch(/SET trainer_client_limit = 5/);
    expect(sql).toContain("up to 5 clients");
    expect(sql).not.toContain("trainer analytics");
    expect(sql).toMatch(
      /jsonb_set\(features, '\{trainer_clients\}', '5'::jsonb, true\)/,
    );
    expect(sql).toMatch(/WHERE tier_name = 'individual_trainer'/);
    expect(sql).toMatch(/trainer_client_limit IS DISTINCT FROM 5/);
    expect(sql).toMatch(
      /features -> 'trainer_clients' IS DISTINCT FROM '5'::jsonb/,
    );
    expect(sql).not.toContain("start_up_coach_plus");
    expect(sql).not.toContain("user_subscriptions");
    expect(sql).not.toContain("profiles");
  });
});
