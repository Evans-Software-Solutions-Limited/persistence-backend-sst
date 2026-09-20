import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";
import { readFileSync } from "node:fs";
vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { FoundingAdminRepository } from "../foundingAdminRepository";
import { FoundingGrantRepository } from "../foundingGrantRepository";
import { AdminAuditRepository } from "../adminAuditRepository";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const ID = "00000000-0000-4000-8000-000000000003";
const migration = (file: string) =>
  readFileSync(
    new URL(`../../../../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );
const ORIGINAL_MIGRATION = migration(
  "20260904120000_founding_offer_referrals.sql",
);
const GENERALISED_GRANT_MIGRATION = migration(
  "20260904214114_generalise_founding_grants.sql",
);
describe("founding admin transaction invariants", () => {
  let pg: PGlite;
  const repo = new FoundingAdminRepository();
  beforeEach(async () => {
    pg = await PGlite.create();
    vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
    await pg.exec(`
      CREATE TABLE profiles (
        id uuid PRIMARY KEY,
        email text,
        role text,
        deleted_at timestamptz
      );
      CREATE TABLE subscription_tiers (
        tier_name text PRIMARY KEY,
        display_name text
      );
      CREATE TABLE user_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        tier_name text NOT NULL,
        currency text,
        payment_status text NOT NULL,
        starts_at timestamptz,
        expires_at timestamptz,
        cancelled_at timestamptz,
        trial_ends_at timestamptz,
        billing_cycle text,
        next_billing_date timestamptz,
        external_subscription_id text,
        metadata jsonb,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE UNIQUE INDEX user_subscriptions_active_unique
        ON user_subscriptions (user_id)
        WHERE payment_status IN ('active', 'pending', 'trialing', 'past_due');
      CREATE UNIQUE INDEX user_subscriptions_external_id_unique
        ON user_subscriptions (external_subscription_id)
        WHERE external_subscription_id IS NOT NULL;
      INSERT INTO profiles (id, email, role) VALUES
        ('${ADMIN}', 'admin@example.test', 'admin'),
        ('${USER}', 'user@example.test', 'user');
      INSERT INTO subscription_tiers (tier_name, display_name)
        VALUES ('premium', 'Premium');
    `);
    await pg.exec(ORIGINAL_MIGRATION);
    await pg.exec(GENERALISED_GRANT_MIGRATION);

    await pg.exec(
      `CREATE ROLE anon; CREATE ROLE authenticated; INSERT INTO subscription_tiers VALUES ('premium_plus','Premium+'), ('coach','Coach'), ('start_up_coach_plus','Start Up Coach+');`,
    );
    await pg.exec(migration("20260905140000_founding_checkout_sessions.sql"));
    await pg.exec(
      migration("20260920193204_founding_checkout_account_binding.sql"),
    );
    await pg.exec(migration("20260920120000_founding_refunds.sql"));
  });
  afterEach(async () => {
    await pg.close();
    vi.restoreAllMocks();
  });
  const create = async (pending = false) =>
    new FoundingGrantRepository().create(
      {
        id: ID,
        userId: pending ? null : USER,
        email: "user@example.test",
        tierName: "premium",
        months: 6,
        amountMinor: 3000,
        currency: "GBP",
        paymentMethod: "stripe_checkout",
        paymentReference: "pi_1",
        paidAt: new Date(),
        referralCodeId: null,
        grantedBy: ADMIN,
        notes: null,
      },
      "consumer",
    );
  it("upgrades the existing paid grant and subscription, preserving expiry, price, payment and seat", async () => {
    await create();
    const before = await new FoundingGrantRepository().findById(ID);
    const oldSub = (
      await pg.query<Record<string, unknown>>(
        "SELECT * FROM user_subscriptions",
      )
    ).rows[0];
    const result = await repo.changeTier(
      ID,
      "premium_plus",
      "First founding member",
      ADMIN,
    );
    expect(result.tierName).toBe("premium_plus");
    const after = await new FoundingGrantRepository().findById(ID);
    expect(after).toEqual({ ...before, tierName: "premium_plus" });
    const sub = (
      await pg.query<Record<string, unknown>>(
        "SELECT * FROM user_subscriptions",
      )
    ).rows[0];
    expect(sub).toEqual({
      ...oldSub,
      tier_name: "premium_plus",
      updated_at: expect.any(Date),
    });
    expect(
      (await new FoundingGrantRepository().seatsForPool("consumer")).used,
    ).toBe(1);
    expect(
      (await new AdminAuditRepository().list({ entityId: ID }))[0],
    ).toMatchObject({
      actorId: ADMIN,
      action: "founding_grant.change_tier",
      before: { tierName: "premium" },
      after: { tierName: "premium_plus" },
      reason: "First founding member",
    });
  });
  it("updates a pending grant so first sign-in receives the new tier", async () => {
    await create(true);
    expect(
      await repo.changeTier(ID, "premium_plus", "Goodwill upgrade", ADMIN),
    ).toEqual({ id: ID, tierName: "premium_plus", expiresAt: null });
    expect(
      await new FoundingGrantRepository().applyPending(ID, USER),
    ).toMatchObject({ applied: true, tierName: "premium_plus" });
  });
  it("rolls back both records if writing the audit fails", async () => {
    await create();
    vi.spyOn(AdminAuditRepository.prototype, "record").mockRejectedValue(
      new Error("audit unavailable"),
    );
    await expect(
      repo.changeTier(ID, "premium_plus", "Upgrade", ADMIN),
    ).rejects.toThrow("audit unavailable");
    expect((await new FoundingGrantRepository().findById(ID))?.tierName).toBe(
      "premium",
    );
    expect(
      (await pg.query("SELECT tier_name FROM user_subscriptions")).rows[0],
    ).toEqual({ tier_name: "premium" });
  });
  it.each(["free", "enterprise", "bogus"])(
    "refuses ungrantable tier %s",
    async (tier) => {
      await expect(
        repo.changeTier(ID, tier, "reason", ADMIN),
      ).rejects.toMatchObject({ code: "invalid_tier" });
    },
  );
  it("refuses a missing grant", async () => {
    await expect(
      repo.changeTier(ID, "premium_plus", "reason", ADMIN),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("refuses switching audience", async () => {
    await create();
    await expect(
      repo.changeTier(ID, "coach", "reason", ADMIN),
    ).rejects.toMatchObject({ code: "different_audience" });
  });
  it("refuses a founding coach tier outside its offer", async () => {
    await create(true);
    await pg.exec("UPDATE founding_grants SET tier_name='start_up_coach_plus'");
    await expect(
      repo.changeTier(ID, "coach", "reason", ADMIN),
    ).rejects.toMatchObject({ code: "different_pool" });
  });
  it("allows a complimentary coach tier change", async () => {
    await create(true);
    await pg.exec(
      "UPDATE founding_grants SET tier_name='start_up_coach_plus', grant_kind='complimentary'",
    );
    expect(await repo.changeTier(ID, "coach", "reason", ADMIN)).toMatchObject({
      tierName: "coach",
    });
  });
  it("refuses a catalogue tier missing in the DB", async () => {
    await create(true);
    await pg.exec(
      "DELETE FROM subscription_tiers WHERE tier_name='premium_plus'",
    );
    await expect(
      repo.changeTier(ID, "premium_plus", "reason", ADMIN),
    ).rejects.toMatchObject({ code: "tier_missing" });
  });
  it.each([
    ["UPDATE founding_grants SET revoked_at=now()", "revoked"],
    ["UPDATE founding_grants SET user_id=null", "account_deleted"],
    [
      "UPDATE profiles SET deleted_at=now() WHERE role='user'",
      "account_pending_deletion",
    ],
    ["UPDATE profiles SET role='admin' WHERE role='user'", "protected_account"],
    [
      "UPDATE profiles SET role='personal_trainer' WHERE role='user'",
      "coach_demotion",
    ],
    [
      "UPDATE user_subscriptions SET expires_at=now()-interval '1 day'",
      "grant_not_active",
    ],
    [
      "UPDATE user_subscriptions SET external_subscription_id='rc_other'",
      "grant_not_active",
    ],
  ])("refuses unsafe changes: %s", async (sql, code) => {
    await create();
    await pg.exec(sql);
    await expect(
      repo.changeTier(ID, "premium_plus", "reason", ADMIN),
    ).rejects.toMatchObject({ code });
  });
  it("stores one durable refund intent and audit across retries", async () => {
    await create();
    expect(await repo.findRefund(ID)).toBeNull();
    const first = await repo.requestRefund(ID, "Customer request", ADMIN);
    expect(await repo.requestRefund(ID, "Customer request", USER)).toEqual(
      first,
    );
    await expect(
      repo.requestRefund(ID, "Different reason", ADMIN),
    ).rejects.toMatchObject({ code: "refund_already_requested" });
    expect(
      await new AdminAuditRepository().list({ entityId: ID }),
    ).toHaveLength(1);
  });
  it("records Stripe state with audit and rejects a different refund id", async () => {
    await create();
    await repo.requestRefund(ID, "Customer request", ADMIN);
    expect(await repo.recordRefund(ID, "re_1", "pending")).toMatchObject({
      refundId: "re_1",
      status: "pending",
    });
    expect(await repo.recordRefund(ID, "re_1", "succeeded")).toMatchObject({
      status: "succeeded",
    });
    expect(await repo.recordRefund(ID, "re_1", "pending")).toMatchObject({
      status: "succeeded",
    });
    expect(await repo.recordRefund(ID, "re_1", "succeeded")).toMatchObject({
      status: "succeeded",
    });
    await expect(
      repo.recordRefund(ID, "re_2", "succeeded"),
    ).rejects.toMatchObject({ code: "refund_mismatch" });
    expect(await repo.recordRefund(ID, "re_1", "failed")).toMatchObject({
      status: "failed",
    });
    expect(await repo.recordRefund(ID, "re_1", "succeeded")).toMatchObject({
      status: "failed",
    });
  });
  it("migration is repeatable and denies direct browser roles", async () => {
    await pg.exec(migration("20260920120000_founding_refunds.sql"));
    expect(
      (
        await pg.query(
          "SELECT relrowsecurity FROM pg_class WHERE relname='founding_refunds'",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true }]);
    expect(
      (
        await pg.query(
          "SELECT has_table_privilege('anon', 'founding_refunds', 'SELECT') AS allowed",
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
  });
});
