import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Schema-parity guard (spec 17 / Phase A, AC-A2.3). The widened
 * single-live-subscription predicate must stay in lockstep between the SQL
 * migration and the Drizzle schema — drift between them means the deployed
 * DB and the ORM's view of the constraint disagree.
 */

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → stripe → application → src → core → microservices → repo root
const repoRoot = resolve(here, "../../../../../..");

const MIGRATION = resolve(
  repoRoot,
  "supabase/migrations/20260605120000_widen_active_subscription_unique.sql",
);
const SCHEMA = resolve(repoRoot, "packages/db/src/schema.ts");

const LIVE_STATUSES = ["active", "pending", "trialing", "past_due"];

describe("user_subscriptions_active_unique predicate parity", () => {
  it("the migration covers all four live statuses", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const status of LIVE_STATUSES) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).toContain(
      "CREATE UNIQUE INDEX user_subscriptions_active_unique",
    );
  });

  it("the Drizzle schema predicate matches the migration (all four live statuses)", () => {
    const schema = readFileSync(SCHEMA, "utf8");
    // The widened predicate string must appear verbatim in schema.ts.
    expect(schema).toContain(
      "payment_status IN ('active', 'pending', 'trialing', 'past_due')",
    );
  });
});
