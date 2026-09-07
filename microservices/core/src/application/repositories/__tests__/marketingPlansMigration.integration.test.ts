import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

/**
 * The marketing-plans migration, applied for real (MARKETING-PLANS § WP4).
 *
 * A mirrored Drizzle table proves nothing about the DDL: the repository suite
 * mocks `getDb`, so a constraint that exists only in `schema.ts` — or one whose
 * SQL is subtly different — ships green. Two things here are only true of the
 * executed SQL and would be invisible otherwise: the CHECK constraints actually
 * reject bad input, and the metrics upsert key is a UNIQUE INDEX over
 * `COALESCE(campaign_slug, '*')` rather than a UNIQUE constraint on the three
 * bare columns, which would silently permit duplicate whole-plan rows.
 */

const migrationSql = (file: string): string =>
  readFileSync(
    new URL(`../../../../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );

const FOUNDING_MIGRATION = migrationSql(
  "20260904120000_founding_offer_referrals.sql",
);
const MARKETING_MIGRATION = migrationSql("20260905120000_marketing_plans.sql");

const ADMIN = "00000000-0000-4000-8000-000000000001";

async function freshDatabase(): Promise<PGlite> {
  const pg = await PGlite.create();
  // The tables the founding migration references but does not own.
  await pg.exec(`
    CREATE TABLE profiles (id uuid PRIMARY KEY);
    CREATE TABLE subscription_tiers (tier_name text PRIMARY KEY);
    CREATE TABLE user_subscriptions (id uuid PRIMARY KEY);
    INSERT INTO profiles (id) VALUES ('${ADMIN}');
    INSERT INTO subscription_tiers (tier_name) VALUES ('premium'), ('premium_plus');
  `);
  await pg.exec(FOUNDING_MIGRATION);
  await pg.exec(MARKETING_MIGRATION);
  return pg;
}

async function insertPlan(
  pg: PGlite,
  slug = "founders-sep-2026",
): Promise<string> {
  const res = await pg.query<{ id: string }>(
    `INSERT INTO marketing_plans (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id`,
    ["Founders' offer", slug, ADMIN],
  );
  return res.rows[0]!.id;
}

describe("20260905120000_marketing_plans.sql", () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = await freshDatabase();
  });

  afterEach(async () => {
    await pg.close();
  });

  it("is idempotent — applying it a second time is a no-op", async () => {
    const planId = await insertPlan(pg);
    await pg.exec(MARKETING_MIGRATION);
    const rows = await pg.query<{ id: string }>(
      `SELECT id FROM marketing_plans`,
    );
    expect(rows.rows).toEqual([{ id: planId }]);
  });

  it("enables row-level security on every new table, with no policies", async () => {
    // Service-role only: these rows are reachable through the core API behind
    // adminGuard and must never be readable through PostgREST.
    const rls = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname LIKE 'marketing_plan%' AND relkind = 'r'
       ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "marketing_plan_channels", relrowsecurity: true },
      { relname: "marketing_plan_codes", relrowsecurity: true },
      { relname: "marketing_plan_metrics", relrowsecurity: true },
      { relname: "marketing_plan_store_offers", relrowsecurity: true },
      { relname: "marketing_plans", relrowsecurity: true },
    ]);
    const policies = await pg.query(
      `SELECT policyname FROM pg_policies WHERE tablename LIKE 'marketing_plan%'`,
    );
    expect(policies.rows).toEqual([]);
  });

  it.each([
    ["upper case", "Founders"],
    ["an underscore", "founders_sep"],
    ["two characters", "fo"],
  ])("rejects a plan slug with %s", async (_label, slug) => {
    await expect(insertPlan(pg, slug)).rejects.toThrow();
  });

  it("rejects an end date before the start date", async () => {
    await expect(
      pg.query(
        `INSERT INTO marketing_plans (name, slug, created_by, starts_on, ends_on)
         VALUES ('x', 'backwards', $1, '2026-09-20', '2026-09-01')`,
        [ADMIN],
      ),
    ).rejects.toThrow();
  });

  it("rejects a brief over 64 KB", async () => {
    await expect(
      pg.query(
        `INSERT INTO marketing_plans (name, slug, created_by, brief_md)
         VALUES ('x', 'huge-brief', $1, $2)`,
        [ADMIN, "a".repeat(65537)],
      ),
    ).rejects.toThrow();
  });

  it("removes a plan's channels, codes, offers and metrics with the plan", async () => {
    const planId = await insertPlan(pg);
    const code = await pg.query<{ id: string }>(
      `INSERT INTO referral_codes (code, display_code, label, kind)
       VALUES ('METATEST', 'METATEST', 'test', 'campaign') RETURNING id`,
    );
    await pg.query(
      `INSERT INTO marketing_plan_channels (plan_id, campaign_slug, label)
       VALUES ($1, 'meta', 'Meta ads')`,
      [planId],
    );
    await pg.query(
      `INSERT INTO marketing_plan_codes (plan_id, referral_code_id) VALUES ($1, $2)`,
      [planId, code.rows[0]!.id],
    );
    await pg.query(
      `INSERT INTO marketing_plan_store_offers
         (plan_id, platform, code, tier_name, duration_months, price_minor)
       VALUES ($1, 'ios', 'FOUNDERS6', 'premium', 6, 3000)`,
      [planId],
    );
    await pg.query(
      `INSERT INTO marketing_plan_metrics (plan_id, metric_date, recorded_by)
       VALUES ($1, '2026-09-12', $2)`,
      [planId, ADMIN],
    );

    await pg.query(`DELETE FROM marketing_plans WHERE id = $1`, [planId]);

    for (const table of [
      "marketing_plan_channels",
      "marketing_plan_codes",
      "marketing_plan_store_offers",
      "marketing_plan_metrics",
    ]) {
      const rows = await pg.query(`SELECT 1 FROM ${table}`);
      expect(rows.rows, table).toEqual([]);
    }
    // The referral code itself survives — a plan owns the LINK, not the code.
    const codes = await pg.query(`SELECT 1 FROM referral_codes`);
    expect(codes.rows).toHaveLength(1);
  });

  it("rejects a store-offer duration Apple does not sell", async () => {
    const planId = await insertPlan(pg);
    await expect(
      pg.query(
        `INSERT INTO marketing_plan_store_offers
           (plan_id, platform, code, tier_name, duration_months, price_minor)
         VALUES ($1, 'ios', 'FOUNDERS4', 'premium', 4, 3000)`,
        [planId],
      ),
    ).rejects.toThrow();
  });

  it("rejects a lower-case store-offer code", async () => {
    const planId = await insertPlan(pg);
    await expect(
      pg.query(
        `INSERT INTO marketing_plan_store_offers
           (plan_id, platform, code, tier_name, duration_months, price_minor)
         VALUES ($1, 'ios', 'founders6', 'premium', 6, 3000)`,
        [planId],
      ),
    ).rejects.toThrow();
  });

  describe("the metrics upsert key", () => {
    it("rejects a second whole-plan row for the same date", async () => {
      // THE reason this is a UNIQUE INDEX over COALESCE(campaign_slug, '*')
      // and not a UNIQUE constraint on the bare columns: NULL is distinct from
      // NULL under UNIQUE, so the plain form would have allowed this — and the
      // whole-plan row is the one the weekly form writes most often.
      const planId = await insertPlan(pg);
      const insert = () =>
        pg.query(
          `INSERT INTO marketing_plan_metrics (plan_id, metric_date, recorded_by, spend_minor)
           VALUES ($1, '2026-09-12', $2, 1000)`,
          [planId, ADMIN],
        );
      await insert();
      await expect(insert()).rejects.toThrow();
    });

    it("rejects a second row for the same channel and date", async () => {
      const planId = await insertPlan(pg);
      const insert = () =>
        pg.query(
          `INSERT INTO marketing_plan_metrics (plan_id, campaign_slug, metric_date, recorded_by)
           VALUES ($1, 'meta', '2026-09-12', $2)`,
          [planId, ADMIN],
        );
      await insert();
      await expect(insert()).rejects.toThrow();
    });

    it("keeps a whole-plan row and a channel row on the same date apart", async () => {
      const planId = await insertPlan(pg);
      await pg.query(
        `INSERT INTO marketing_plan_metrics (plan_id, metric_date, recorded_by)
         VALUES ($1, '2026-09-12', $2)`,
        [planId, ADMIN],
      );
      await pg.query(
        `INSERT INTO marketing_plan_metrics (plan_id, campaign_slug, metric_date, recorded_by)
         VALUES ($1, 'meta', '2026-09-12', $2)`,
        [planId, ADMIN],
      );
      const rows = await pg.query(`SELECT 1 FROM marketing_plan_metrics`);
      expect(rows.rows).toHaveLength(2);
    });

    it("cannot be collided by a channel literally named '*' — the sentinel is not a legal slug", async () => {
      const planId = await insertPlan(pg);
      await expect(
        pg.query(
          `INSERT INTO marketing_plan_metrics (plan_id, campaign_slug, metric_date, recorded_by)
           VALUES ($1, '*', '2026-09-12', $2)`,
          [planId, ADMIN],
        ),
      ).rejects.toThrow();
    });
  });
});
