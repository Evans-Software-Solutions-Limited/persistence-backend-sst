import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { BlcCheckoutRepository } from "../blcCheckoutRepository";

const USER = "00000000-0000-4000-8000-000000000011";
const OTHER = "00000000-0000-4000-8000-000000000022";

/**
 * Against a real Postgres: both answers are WHERE clauses (the shared live
 * filter, the non-free guard, the external id match), and a mocked `getDb`
 * would return whatever it was told to.
 */
describe("BlcCheckoutRepository", () => {
  let pg: PGlite;
  const repo = new BlcCheckoutRepository();

  beforeEach(async () => {
    pg = await PGlite.create();
    vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
    await pg.exec(`
      CREATE TABLE profiles (id uuid PRIMARY KEY, email text, role text, deleted_at timestamptz);
      CREATE TABLE user_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        tier_name text,
        payment_status text,
        expires_at timestamptz,
        external_subscription_id text
      );
      INSERT INTO profiles (id, email, role) VALUES
        ('${USER}', 'member@example.test', 'user'),
        ('${OTHER}', 'other@example.test', 'user');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  const subscription = (
    userId: string,
    tier: string,
    status: string,
    expiresAt: string | null,
    externalId = "sub_x",
  ) =>
    pg.exec(
      `INSERT INTO user_subscriptions (user_id, tier_name, payment_status, expires_at, external_subscription_id)
       VALUES ('${userId}', '${tier}', '${status}', ${expiresAt ? `'${expiresAt}'` : "NULL"}, '${externalId}')`,
    );

  describe("eligibility", () => {
    it("allows an ordinary account with no paid subscription", async () => {
      expect(await repo.eligibility(USER)).toBeNull();
    });

    it("allows an account whose only row is the free tier", async () => {
      await subscription(USER, "free", "active", null);
      expect(await repo.eligibility(USER)).toBeNull();
    });

    it("refuses an account that already has a LIVE paid subscription", async () => {
      await subscription(USER, "premium", "active", "2999-01-01T00:00:00Z");
      expect(await repo.eligibility(USER)).toBe("active_subscription");
    });

    it("refuses while a cancelled subscription is still inside its paid period", async () => {
      await subscription(USER, "premium", "cancelled", "2999-01-01T00:00:00Z");
      expect(await repo.eligibility(USER)).toBe("active_subscription");
    });

    it("allows once the old subscription has lapsed", async () => {
      await subscription(USER, "premium", "active", "2000-01-01T00:00:00Z");
      await subscription(USER, "premium_plus", "expired", null);
      expect(await repo.eligibility(USER)).toBeNull();
    });

    it("does not count ANOTHER user's live subscription", async () => {
      await subscription(OTHER, "premium", "active", null);
      expect(await repo.eligibility(USER)).toBeNull();
    });

    it("refuses an account with no profile", async () => {
      expect(
        await repo.eligibility("00000000-0000-4000-8000-000000000099"),
      ).toBe("account_ineligible");
    });

    it("refuses a soft-deleted account", async () => {
      await pg.exec(
        `UPDATE profiles SET deleted_at = now() WHERE id = '${USER}'`,
      );
      expect(await repo.eligibility(USER)).toBe("account_ineligible");
    });

    it.each(["admin", "personal_trainer", "physiotherapist"])(
      "refuses a %s account — the BLC tiers are consumer tiers",
      async (role) => {
        await pg.exec(
          `UPDATE profiles SET role = '${role}' WHERE id = '${USER}'`,
        );
        expect(await repo.eligibility(USER)).toBe("account_ineligible");
      },
    );
  });

  describe("isLiveSubscription", () => {
    it("is false until the webhook has written the row", async () => {
      expect(await repo.isLiveSubscription("sub_blc_1")).toBe(false);
    });

    it("is true for a live row carrying that Stripe subscription id", async () => {
      await subscription(USER, "premium", "active", null, "sub_blc_1");
      expect(await repo.isLiveSubscription("sub_blc_1")).toBe(true);
    });

    it("is false for a row that exists but is not live", async () => {
      await subscription(USER, "premium", "incomplete", null, "sub_blc_1");
      expect(await repo.isLiveSubscription("sub_blc_1")).toBe(false);
    });

    it("does not match a different subscription id", async () => {
      await subscription(USER, "premium", "active", null, "sub_other");
      expect(await repo.isLiveSubscription("sub_blc_1")).toBe(false);
    });
  });
});
