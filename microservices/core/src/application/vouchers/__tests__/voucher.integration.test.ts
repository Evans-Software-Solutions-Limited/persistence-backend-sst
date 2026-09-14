import { GRANTABLE_TIERS } from "@persistence/subscription-catalog";
import { FoundingGrantService } from "../../founding/foundingGrantService";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { VoucherRepository } from "../../repositories/voucherRepository";
import { VoucherService } from "../voucherService";
import { hashSecret, type BatchInput } from "../voucherRules";
vi.mock("../../revenuecat/revenueCatClient", () => ({
  fetchCustomerSubscriptions: vi.fn(async () => []),
}));
import { syncRevenueCatCustomer } from "../../revenuecat/revenueCatSync";
import { FoundingGrantRepository } from "../../repositories/foundingGrantRepository";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const migration = (name: string) =>
  readFileSync(
    new URL(`../../../../../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
let pg: PGlite;
let repo: VoucherRepository;
let service: VoucherService;
const mailer = vi.fn();
const identity = vi.fn();
const input: BatchInput = {
  businessName: "Acme",
  quantity: 1,
  tierName: "premium",
  months: 12,
  allowedDomains: [],
  redeemBy: null,
};
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
  await pg.exec(migration("20260904120000_founding_offer_referrals.sql"));
  await pg.exec(migration("20260904214114_generalise_founding_grants.sql"));
  await pg.exec(migration("20260914143040_business_vouchers.sql"));
  await pg.exec(migration("20260914161842_grant_all_membership_tiers.sql"));
  await pg.query(
    "INSERT INTO profiles(id,email,role) VALUES($1,'other@example.test','user')",
    [OTHER],
  );
  mailer.mockReset().mockResolvedValue(undefined);
  identity.mockReset().mockImplementation(async (id: string) => ({
    id,
    email: id === USER ? "user@example.test" : "other@example.test",
    emailConfirmedAt: new Date().toISOString(),
  }));
  repo = new VoucherRepository();
  service = new VoucherService(repo, identity, mailer);
});
afterEach(async () => {
  await pg.close();
});
async function issue(overrides: Partial<BatchInput> = {}) {
  return repo.create({ ...input, ...overrides }, ADMIN);
}
async function ready() {
  const issued = await issue();
  const challenge = await service.prepare(
    USER,
    issued.codes[0].code,
    "user@example.test",
  );
  return { issued, challenge };
}
describe("voucher issue and administration", () => {
  it("persists hash only, normalizes restrictions, and records admin mutations", async () => {
    const issued = await issue({
      quantity: 2,
      allowedDomains: ["EXAMPLE.TEST"],
      employeeEmails: [" USER@example.test ", ""],
    });
    const stored = await pg.query<{ code_hash: string; code_hint: string }>(
      "SELECT code_hash,code_hint FROM business_vouchers ORDER BY employee_email",
    );
    expect(
      stored.rows.some((v) => v.code_hash === hashSecret(issued.codes[0].code)),
    ).toBe(true);
    expect(JSON.stringify(stored.rows)).not.toContain(issued.codes[0].code);
    expect((await repo.list("Acme"))[0].counts).toEqual({
      issued: 2,
      unused: 2,
      redeemed: 0,
      expired: 0,
      revoked: 0,
    });
    expect(await repo.list("missing")).toEqual([]);
    await repo.assign(
      issued.batch.id,
      [
        { voucherId: issued.codes[0].id, employeeEmail: null },
        { voucherId: issued.codes[1].id, employeeEmail: "user@example.test" },
      ],
      ADMIN,
    );
    expect(
      (await repo.detail(issued.batch.id)).vouchers.find(
        (v) => v.id === issued.codes[1].id,
      )?.employeeEmail,
    ).toBe("user@example.test");
    expect(await repo.exportAudit(issued.batch.id, ADMIN)).toEqual({
      recorded: true,
    });
    expect(
      await repo.revoke(issued.batch.id, issued.codes[0].id, "Lost", ADMIN),
    ).toEqual({ revoked: 1 });
    expect(
      await repo.revoke(issued.batch.id, undefined, "Cancel remainder", ADMIN),
    ).toEqual({ revoked: 1 });
    expect((await repo.detail(issued.batch.id)).batch.counts.revoked).toBe(2);
    expect((await pg.query("SELECT * FROM admin_audit_log")).rows).toHaveLength(
      5,
    );
  });
  it.each([
    { businessName: " " },
    { quantity: 0 },
    { months: 121 },
    { redeemBy: "bad" },
    { redeemBy: "2000-01-01" },
    { employeeEmails: [] },
    { employeeEmails: ["bad"] },
    { quantity: 2, employeeEmails: ["a@acme.com", "A@ACME.COM"] },
    { allowedDomains: ["evil@acme.com"] },
    { allowedDomains: ["acme.com"], employeeEmails: ["a@other.com"] },
  ])("rejects invalid batch without writes %j", async (invalid) => {
    await expect(issue(invalid)).rejects.toThrow();
    expect((await repo.list()).length).toBe(0);
  });
  it("rolls back a conflicting assignment import and allows atomic swaps", async () => {
    const { batch, codes } = await issue({
      quantity: 2,
      employeeEmails: ["a@acme.com", "b@acme.com"],
    });
    await expect(
      repo.assign(
        batch.id,
        [{ voucherId: codes[0].id, employeeEmail: "b@acme.com" }],
        ADMIN,
      ),
    ).rejects.toMatchObject({ code: "duplicate_employee" });
    await repo.assign(
      batch.id,
      [
        { voucherId: codes[0].id, employeeEmail: "b@acme.com" },
        { voucherId: codes[1].id, employeeEmail: "a@acme.com" },
      ],
      ADMIN,
    );
    expect(
      (await repo.detail(batch.id)).vouchers.find((v) => v.id === codes[0].id)
        ?.employeeEmail,
    ).toBe("b@acme.com");
    await expect(
      repo.assign(
        batch.id,
        [
          { voucherId: codes[0].id, employeeEmail: null },
          { voucherId: codes[0].id, employeeEmail: null },
        ],
        ADMIN,
      ),
    ).rejects.toThrow();
    await expect(
      repo.assign(
        batch.id,
        [{ voucherId: randomUUID(), employeeEmail: null }],
        ADMIN,
      ),
    ).rejects.toThrow();
    await expect(repo.detail(randomUUID())).rejects.toThrow();
    await expect(
      repo.revoke(randomUUID(), undefined, "Reason", ADMIN),
    ).rejects.toThrow();
    await expect(
      repo.revoke(batch.id, undefined, " ", ADMIN),
    ).rejects.toThrow();
  });
});
describe("eligibility proof", () => {
  it("reuses authoritative same email without sending mail and grants one subscription", async () => {
    const { issued, challenge } = await ready();
    expect(challenge.verified).toBe(true);
    expect(mailer).not.toHaveBeenCalled();
    const result = await service.redeem(USER, challenge.challengeId);
    expect(result).toMatchObject({
      voucherId: issued.codes[0].id,
      accountEmail: "user@example.test",
      eligibilityEmail: "user@example.test",
      months: 12,
    });
    const [sub] = (
      await pg.query<{
        metadata: Record<string, string>;
        payment_status: string;
      }>("SELECT metadata,payment_status FROM user_subscriptions")
    ).rows;
    expect(sub.metadata.source).toBe("business_voucher");
    expect(sub.payment_status).toBe("active");
    expect((await pg.query("SELECT * FROM founding_grants")).rows).toHaveLength(
      0,
    );
    expect(await service.redeem(USER, challenge.challengeId)).toEqual(result);
    expect((await repo.detail(issued.batch.id)).batch.counts.redeemed).toBe(1);
    expect(
      await repo.revoke(issued.batch.id, undefined, "Unused only", ADMIN),
    ).toEqual({ revoked: 0 });
    await expect(
      repo.assign(
        issued.batch.id,
        [{ voucherId: issued.codes[0].id, employeeEmail: null }],
        ADMIN,
      ),
    ).rejects.toThrow();
  });
  it("allows different membership email only after work mailbox OTP and exact/domain checks", async () => {
    const issued = await issue({
      allowedDomains: ["acme.com"],
      employeeEmails: ["employee@acme.com"],
    });
    const c = await service.prepare(
      USER,
      issued.codes[0].code,
      "employee@acme.com",
    );
    expect(c.verified).toBe(false);
    await expect(service.redeem(USER, c.challengeId)).rejects.toThrow();
    const text = mailer.mock.calls[0][0].text as string;
    const otp = text.match(/code is (\d{6})/)![1];
    expect((await service.verify(USER, c.challengeId, otp)).verified).toBe(
      true,
    );
    expect(await service.redeem(USER, c.challengeId)).toMatchObject({
      accountEmail: "user@example.test",
      eligibilityEmail: "employee@acme.com",
    });
  });
  it.each([
    "employee@fakeacme.com",
    "employee@sub.acme.com",
    "someone@acme.com",
  ])("rejects noneligible %s", async (email) => {
    const issued = await issue({
      allowedDomains: ["acme.com"],
      employeeEmails: ["employee@acme.com"],
    });
    await expect(
      service.prepare(USER, issued.codes[0].code, email),
    ).rejects.toThrow();
    expect(mailer).not.toHaveBeenCalled();
  });
  it("limits wrong OTP to five durable attempts and binds account and email", async () => {
    const issued = await issue();
    const c = await service.prepare(
      USER,
      issued.codes[0].code,
      "work@acme.com",
    );
    const otp = (mailer.mock.calls[0][0].text as string).match(
      /code is (\d{6})/,
    )![1];
    await expect(service.verify(OTHER, c.challengeId, otp)).rejects.toThrow();
    const wrong = otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++)
      await expect(
        service.verify(USER, c.challengeId, wrong),
      ).rejects.toThrow();
    await expect(service.verify(USER, c.challengeId, otp)).rejects.toThrow();
    expect(
      (
        await pg.query<{ attempts: number }>(
          "SELECT attempts FROM business_voucher_challenges",
        )
      ).rows[0].attempts,
    ).toBe(5);
  });
  it("expires proof, detects authoritative email changes and rejects unconfirmed identities", async () => {
    const { challenge } = await ready();
    await pg.query(
      "UPDATE business_voucher_challenges SET expires_at=now()-interval '1 second'",
    );
    await expect(service.redeem(USER, challenge.challengeId)).rejects.toThrow();
    const second = await ready();
    identity.mockResolvedValue({
      id: USER,
      email: "changed@example.test",
      emailConfirmedAt: new Date().toISOString(),
    });
    await expect(
      service.redeem(USER, second.challenge.challengeId),
    ).rejects.toThrow();
    identity.mockResolvedValue({
      id: USER,
      email: "user@example.test",
      emailConfirmedAt: null,
    });
    await expect(
      service.redeem(USER, second.challenge.challengeId),
    ).rejects.toMatchObject({ code: "verified_account_required" });
  });
  it("fails visibly on delivery failure and deletes unusable challenge", async () => {
    const issued = await issue();
    mailer.mockRejectedValue(new Error("provider unavailable"));
    await expect(
      service.prepare(USER, issued.codes[0].code, "work@acme.com"),
    ).rejects.toMatchObject({ code: "delivery_failed", status: 503 });
    expect(
      (await pg.query("SELECT * FROM business_voucher_challenges")).rows,
    ).toHaveLength(0);
    expect((await repo.detail(issued.batch.id)).batch.counts.unused).toBe(1);
  });
  it("rate budgets persist independently of failed lookups and reset by time", async () => {
    for (let i = 0; i < 20; i++)
      await expect(
        service.prepare(USER, "missing", "user@example.test"),
      ).rejects.toThrow();
    await expect(
      service.prepare(USER, "missing", "user@example.test"),
    ).rejects.toMatchObject({ code: "rate_limited" });
    await pg.exec(
      "UPDATE business_voucher_rate_limits SET resets_at=now()-interval '1 second'",
    );
    await expect(
      service.prepare(USER, "missing", "user@example.test"),
    ).rejects.toMatchObject({ code: "invalid_voucher" });
  });
});
describe("atomic redemption", () => {
  it("serializes concurrent completed-request retries into exactly one grant", async () => {
    const { challenge } = await ready();
    const results = await Promise.all([
      service.redeem(USER, challenge.challengeId),
      service.redeem(USER, challenge.challengeId),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      (await pg.query("SELECT * FROM user_subscriptions")).rows,
    ).toHaveLength(1);
  });
  it("competing accounts can consume a voucher only once", async () => {
    const issued = await issue();
    const a = await service.prepare(
      USER,
      issued.codes[0].code,
      "user@example.test",
    );
    const b = await service.prepare(
      OTHER,
      issued.codes[0].code,
      "other@example.test",
    );
    const results = await Promise.allSettled([
      service.redeem(USER, a.challengeId),
      service.redeem(OTHER, b.challengeId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await pg.query("SELECT * FROM user_subscriptions")).rows,
    ).toHaveLength(1);
  });
  it.each(["active", "cancelled", "trialing", "past_due"])(
    "rejects live %s paid memberships without consuming",
    async (paymentStatus) => {
      const { issued, challenge } = await ready();
      await pg.query(
        "INSERT INTO user_subscriptions(user_id,tier_name,payment_status,expires_at,external_subscription_id) VALUES($1,'premium',$2,now()+interval '1 year','rc_test')",
        [USER, paymentStatus],
      );
      await expect(
        service.redeem(USER, challenge.challengeId),
      ).rejects.toMatchObject({ code: "subscription_conflict" });
      expect((await repo.detail(issued.batch.id)).batch.counts.unused).toBe(1);
    },
  );
  it.each(["personal_trainer", "admin", "physiotherapist"])(
    "protects %s role",
    async (role) => {
      const { challenge } = await ready();
      await pg.query("UPDATE profiles SET role=$1 WHERE id=$2", [role, USER]);
      await expect(
        service.redeem(USER, challenge.challengeId),
      ).rejects.toMatchObject({ code: "account_conflict" });
    },
  );
  it("rejects soft-deleted profile and preserves redemption across hard deletion", async () => {
    const { challenge, issued } = await ready();
    await pg.query("UPDATE profiles SET deleted_at=now() WHERE id=$1", [USER]);
    await expect(
      service.redeem(USER, challenge.challengeId),
    ).rejects.toMatchObject({ code: "account_unavailable" });
    await pg.query("UPDATE profiles SET deleted_at=NULL WHERE id=$1", [USER]);
    await service.redeem(USER, challenge.challengeId);
    await pg.query("DELETE FROM user_subscriptions WHERE user_id=$1", [USER]);
    await pg.query("DELETE FROM profiles WHERE id=$1", [USER]);
    expect((await repo.detail(issued.batch.id)).vouchers[0]).toMatchObject({
      accountId: USER,
      status: "redeemed",
    });
  });
  it("rolls back entitlement if audit persistence fails", async () => {
    const { challenge, issued } = await ready();
    await pg.exec(
      "ALTER TABLE admin_audit_log ADD CONSTRAINT test_reject_redemption CHECK (action <> 'business_voucher.redeem')",
    );
    await expect(service.redeem(USER, challenge.challengeId)).rejects.toThrow();
    expect(
      (await pg.query("SELECT * FROM user_subscriptions")).rows,
    ).toHaveLength(0);
    expect((await repo.detail(issued.batch.id)).batch.counts.unused).toBe(1);
  });
  it("revalidates revocation, deadline and assignment after proof", async () => {
    const { challenge, issued } = await ready();
    await repo.assign(
      issued.batch.id,
      [{ voucherId: issued.codes[0].id, employeeEmail: "other@example.test" }],
      ADMIN,
    );
    await expect(service.redeem(USER, challenge.challengeId)).rejects.toThrow();
    await repo.assign(
      issued.batch.id,
      [{ voucherId: issued.codes[0].id, employeeEmail: null }],
      ADMIN,
    );
    await pg.query(
      "UPDATE business_voucher_batches SET redeem_by=now()-interval '1 second'",
    );
    await expect(service.redeem(USER, challenge.challengeId)).rejects.toThrow();
    expect((await repo.detail(issued.batch.id)).batch.counts.expired).toBe(1);
  });
  it("existing administrative writer cannot displace prepaid voucher", async () => {
    const { challenge } = await ready();
    await service.redeem(USER, challenge.challengeId);
    const result = await new FoundingGrantRepository().create(
      {
        id: randomUUID(),
        userId: USER,
        email: "user@example.test",
        tierName: "premium",
        months: 6,
        grantKind: "complimentary",
        amountMinor: 0,
        currency: "GBP",
        paymentMethod: null,
        paymentReference: null,
        paidAt: null,
        referralCodeId: null,
        grantedBy: ADMIN,
        notes: null,
      },
      "consumer",
    );
    expect(result.kind).toBe("active_store_subscription");
    expect(
      (await pg.query("SELECT * FROM user_subscriptions")).rows,
    ).toHaveLength(1);
  });
});

it("RevenueCat empty snapshot preserves voucher entitlement on app refresh", async () => {
  const { challenge } = await ready();
  await service.redeem(USER, challenge.challengeId);
  expect(await syncRevenueCatCustomer(USER)).toBe("already_inactive");
  expect(
    (
      await pg.query<{ payment_status: string }>(
        "SELECT payment_status FROM user_subscriptions",
      )
    ).rows[0].payment_status,
  ).toBe("active");
});
it("releases a lapsed voucher's unique slot for Stripe without freeing its code", async () => {
  const { challenge } = await ready();
  await service.redeem(USER, challenge.challengeId);
  const subscriptions = new SubscriptionRepository();
  await subscriptions.expireLapsedBusinessVouchers(USER);
  expect(
    (await pg.query("SELECT payment_status FROM user_subscriptions")).rows,
  ).toEqual([{ payment_status: "active" }]);
  await pg.query(
    "UPDATE user_subscriptions SET expires_at=now()-interval '1 day' WHERE user_id=$1",
    [USER],
  );
  await subscriptions.expireLapsedBusinessVouchers(OTHER);
  expect(
    (await pg.query("SELECT payment_status FROM user_subscriptions")).rows,
  ).toEqual([{ payment_status: "active" }]);
  await subscriptions.expireLapsedBusinessVouchers(USER);
  await subscriptions.insert({
    userId: USER,
    tierName: "premium",
    paymentStatus: "active",
    externalSubscriptionId: "sub_after_voucher",
    metadata: { stripe_subscription_id: "sub_after_voucher" },
  });
  expect(
    (
      await pg.query(
        "SELECT payment_status FROM user_subscriptions ORDER BY created_at",
      )
    ).rows,
  ).toEqual([{ payment_status: "expired" }, { payment_status: "active" }]);
  expect(
    (await service.redeem(USER, challenge.challengeId)).voucherId,
  ).toBeTruthy();
  expect(
    (
      await pg.query(
        "SELECT * FROM business_vouchers WHERE redeemed_at IS NOT NULL",
      )
    ).rows,
  ).toHaveLength(1);
});
it("does not retire expired Stripe rows or vouchers without an expiry", async () => {
  await pg.query(
    "INSERT INTO user_subscriptions(user_id,tier_name,payment_status,expires_at,metadata) VALUES($1,'premium','active',now()-interval '1 day','{\"source\":\"stripe\"}'),($2,'premium','active',NULL,'{\"source\":\"business_voucher\"}')",
    [USER, OTHER],
  );
  const subscriptions = new SubscriptionRepository();
  await subscriptions.expireLapsedBusinessVouchers(USER);
  await subscriptions.expireLapsedBusinessVouchers(OTHER);
  expect(
    (await pg.query("SELECT payment_status FROM user_subscriptions")).rows,
  ).toEqual([{ payment_status: "active" }, { payment_status: "active" }]);
});
it("allows historical expired grants but blocks pending grants", async () => {
  const { challenge } = await ready();
  await pg.query(
    "INSERT INTO founding_grants(email,tier_name,months,amount_minor,currency,granted_by,user_id,applied_at) VALUES('user@example.test','premium',6,0,'GBP',$1,$2,now()-interval '1 year')",
    [ADMIN, USER],
  );
  await service.redeem(USER, challenge.challengeId);
  expect(
    (await pg.query("SELECT * FROM user_subscriptions")).rows,
  ).toHaveLength(1);
});
it("blocks pending grant for verified account email", async () => {
  const { challenge } = await ready();
  await pg.query(
    "INSERT INTO founding_grants(email,tier_name,months,amount_minor,currency,granted_by) VALUES('user@example.test','premium',6,0,'GBP',$1)",
    [ADMIN],
  );
  await expect(
    service.redeem(USER, challenge.challengeId),
  ).rejects.toMatchObject({ code: "subscription_conflict" });
});

it("database denies reversing a completed voucher and enables RLS on all new tables", async () => {
  const { challenge, issued } = await ready();
  await service.redeem(USER, challenge.challengeId);
  await expect(
    pg.query(
      "UPDATE business_vouchers SET redeemed_at=NULL, account_id=NULL,subscription_id=NULL WHERE id=$1",
      [issued.codes[0].id],
    ),
  ).rejects.toThrow("Redeemed vouchers are immutable");
  await expect(
    pg.query("DELETE FROM business_vouchers WHERE id=$1", [issued.codes[0].id]),
  ).rejects.toThrow("Redeemed vouchers are immutable");
  const rows = await pg.query<{ relrowsecurity: boolean }>(
    "SELECT relrowsecurity FROM pg_class WHERE relname IN ('business_voucher_batches','business_vouchers','business_voucher_challenges','business_voucher_rate_limits')",
  );
  expect(rows.rows).toHaveLength(4);
  expect(rows.rows.every((r) => r.relrowsecurity)).toBe(true);
});

it("bounds cleanup while retaining active proofs, live counters and permanent redemptions", async () => {
  const { challenge, issued } = await ready();
  await service.redeem(USER, challenge.challengeId);
  const current = await service.prepare(
    OTHER,
    (await issue()).codes[0].code,
    "other@example.test",
  );
  await pg.query(
    `INSERT INTO business_voucher_challenges
    (voucher_id,account_id,account_email,eligibility_email,expires_at)
    SELECT $1,$2,'abandoned@acme.com','abandoned@acme.com',now()-interval '1 day'
    FROM generate_series(1,105)`,
    [issued.codes[0].id, USER],
  );
  await pg.query(
    `INSERT INTO business_voucher_challenges
    (voucher_id,account_id,account_email,eligibility_email,expires_at,completed_at)
    SELECT $1,$2,'old@acme.com','old@acme.com',now()-interval '31 days',now()-interval '31 days'
    FROM generate_series(1,105)`,
    [issued.codes[0].id, USER],
  );
  await pg.exec(`INSERT INTO business_voucher_rate_limits(key,attempts,resets_at)
    SELECT 'expired-'||n,1,now()-interval '1 day' FROM generate_series(1,105) n`);
  await repo.cleanupExpiredProofs();
  expect(
    (
      await pg.query(
        "SELECT id FROM business_voucher_challenges WHERE eligibility_email='abandoned@acme.com'",
      )
    ).rows,
  ).toHaveLength(5);
  expect(
    (
      await pg.query(
        "SELECT id FROM business_voucher_challenges WHERE eligibility_email='old@acme.com'",
      )
    ).rows,
  ).toHaveLength(5);
  expect(
    (
      await pg.query(
        "SELECT key FROM business_voucher_rate_limits WHERE key LIKE 'expired-%'",
      )
    ).rows,
  ).toHaveLength(5);
  expect(
    (
      await pg.query(
        "SELECT id FROM business_voucher_challenges WHERE id IN ($1,$2)",
        [challenge.challengeId, current.challengeId],
      )
    ).rows,
  ).toHaveLength(2);
  expect(
    (
      await pg.query(
        "SELECT key FROM business_voucher_rate_limits WHERE resets_at>now()",
      )
    ).rows.length,
  ).toBeGreaterThan(0);
  expect((await repo.detail(issued.batch.id)).vouchers[0].status).toBe(
    "redeemed",
  );
  await repo.cleanupExpiredProofs();
  expect(
    (
      await pg.query(
        "SELECT id FROM business_voucher_challenges WHERE eligibility_email IN ('abandoned@acme.com','old@acme.com')",
      )
    ).rows,
  ).toHaveLength(0);
  expect(await service.redeem(USER, challenge.challengeId)).toMatchObject({
    voucherId: issued.codes[0].id,
  });
});

it("request paths purge expired ephemeral state and cap replay at 30 days", async () => {
  const { challenge, issued } = await ready();
  await service.redeem(USER, challenge.challengeId);
  await pg.query(
    "UPDATE business_voucher_challenges SET completed_at=now()-interval '31 days' WHERE id=$1",
    [challenge.challengeId],
  );
  // Direct repository path still enforces the retention window if cleanup has a backlog.
  await expect(
    repo.redeem(
      { id: USER, email: "user@example.test" },
      challenge.challengeId,
    ),
  ).rejects.toThrow();
  await expect(service.redeem(USER, challenge.challengeId)).rejects.toThrow();
  expect(
    (
      await pg.query("SELECT id FROM business_voucher_challenges WHERE id=$1", [
        challenge.challengeId,
      ])
    ).rows,
  ).toHaveLength(0);
  expect((await repo.detail(issued.batch.id)).vouchers[0]).toMatchObject({
    status: "redeemed",
    accountId: USER,
  });
});

async function installProductionSubscriptionFunctions() {
  await pg.exec(`
 CREATE TYPE user_role AS ENUM ('user','personal_trainer','physiotherapist','admin');
 ALTER TABLE profiles ADD COLUMN subscription_id uuid;
 ALTER TABLE subscription_tiers
 ADD COLUMN features jsonb DEFAULT '{}', ADD COLUMN workout_limit integer,
 ADD COLUMN ai_access boolean DEFAULT true, ADD COLUMN ai_workout_limit integer DEFAULT 30,
 ADD COLUMN gym_buddy_access boolean DEFAULT true, ADD COLUMN gym_buddy_can_create_workouts boolean DEFAULT true,
 ADD COLUMN gym_buddy_can_suggest_workouts boolean DEFAULT true, ADD COLUMN trainer_client_limit integer,
 ADD COLUMN is_trainer_tier boolean DEFAULT false, ADD COLUMN analytics_access boolean DEFAULT false,
 ADD COLUMN export_access boolean DEFAULT false;
 CREATE TABLE subscription_limits (user_id uuid,limit_type text,limit_value integer,current_count integer DEFAULT 0,reset_date timestamptz,updated_at timestamptz,PRIMARY KEY(user_id,limit_type));
 `);
  for (const tier of GRANTABLE_TIERS)
    await pg.query(
      `INSERT INTO subscription_tiers(tier_name,display_name,is_trainer_tier,trainer_client_limit)
 VALUES($1,$2,$3,$4) ON CONFLICT(tier_name) DO UPDATE SET display_name=EXCLUDED.display_name,is_trainer_tier=EXCLUDED.is_trainer_tier,trainer_client_limit=EXCLUDED.trainer_client_limit`,
      [tier.id, tier.name, tier.audience === "coach", tier.clients],
    );
  // Execute the actual production functions and trigger, not a test reimplementation.
  const coreFunctions = migration("002_functions_and_triggers.sql");
  const subscriptions = migration("004_subscriptions_and_roles.sql");
  const extract = (source: string, name: string) => {
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
    const end = source.indexOf("$$ LANGUAGE plpgsql", start);
    return source.slice(start, source.indexOf(";", end) + 1);
  };
  await pg.exec(extract(coreFunctions, "get_user_subscription"));
  await pg.exec(extract(subscriptions, "update_subscription_limits"));
  await pg.exec(extract(subscriptions, "trigger_update_subscription_limits"));
  await pg.exec(
    "CREATE TRIGGER update_subscription_limits_trigger AFTER INSERT OR UPDATE ON user_subscriptions FOR EACH ROW EXECUTE FUNCTION trigger_update_subscription_limits()",
  );
}
it.each(GRANTABLE_TIERS)(
  "redeems $name voucher with production role and limit propagation",
  async (tier) => {
    await installProductionSubscriptionFunctions();
    const issued = await issue({ tierName: tier.id, months: 3 });
    const c = await service.prepare(
      USER,
      issued.codes[0].code,
      "user@example.test",
    );
    const result = await service.redeem(USER, c.challengeId);
    expect(result.tierName).toBe(tier.id);
    expect(
      (
        await pg.query<{ role: string }>(
          "SELECT role FROM profiles WHERE id=$1",
          [USER],
        )
      ).rows[0].role,
    ).toBe(tier.audience === "coach" ? "personal_trainer" : "user");
    expect(
      (
        await pg.query<{ trainer_client_limit: number | null }>(
          "SELECT trainer_client_limit FROM get_user_subscription($1)",
          [USER],
        )
      ).rows[0].trainer_client_limit,
    ).toBe(tier.clients);
    const sub = (
      await pg.query<{ starts_at: Date; expires_at: Date }>(
        "SELECT starts_at,expires_at FROM user_subscriptions WHERE user_id=$1",
        [USER],
      )
    ).rows[0];
    expect(sub.expires_at.getUTCMonth()).toBe(
      (sub.starts_at.getUTCMonth() + 3) % 12,
    );
    expect((await pg.query("SELECT * FROM founding_grants")).rows).toHaveLength(
      0,
    );
  },
);
it.each(GRANTABLE_TIERS)(
  "grants individual complimentary $name with configurable duration",
  async (tier) => {
    await installProductionSubscriptionFunctions();
    const grantService = new FoundingGrantService();
    const result = await grantService.grant(
      {
        email: "user@example.test",
        tierName: tier.id,
        grantKind: "complimentary",
        months: 18,
        sendInvite: false,
      },
      ADMIN,
    );
    expect(result).toMatchObject({
      ok: true,
      result: { tierName: tier.id, months: 18, seats: null },
    });
    expect(
      (
        await pg.query<{ role: string }>(
          "SELECT role FROM profiles WHERE id=$1",
          [USER],
        )
      ).rows[0].role,
    ).toBe(tier.audience === "coach" ? "personal_trainer" : "user");
    expect(
      (
        await pg.query<{ trainer_client_limit: number | null }>(
          "SELECT trainer_client_limit FROM get_user_subscription($1)",
          [USER],
        )
      ).rows[0].trainer_client_limit,
    ).toBe(tier.clients);
  },
);
it("applies pending coach access through normal verified signup", async () => {
  await installProductionSubscriptionFunctions();
  await pg.query("DELETE FROM profiles WHERE id=$1", [OTHER]);
  const grantService = new FoundingGrantService(
    undefined,
    undefined,
    undefined,
    mailer,
    "https://example.test",
    identity,
  );
  expect(
    await grantService.grant(
      {
        email: "other@example.test",
        tierName: "coach_pro",
        grantKind: "complimentary",
        months: 24,
        sendInvite: false,
      },
      ADMIN,
    ),
  ).toMatchObject({ ok: true, result: { status: "pending" } });
  await pg.query(
    "INSERT INTO profiles(id,email,role) VALUES($1,'other@example.test','user')",
    [OTHER],
  );
  expect(
    await grantService.applyPendingForUser(OTHER, "other@example.test"),
  ).toBe(true);
  expect(
    (
      await pg.query<{ role: string }>(
        "SELECT role FROM profiles WHERE id=$1",
        [OTHER],
      )
    ).rows[0].role,
  ).toBe("personal_trainer");
});
it("permits existing coach vouchers but refuses silent consumer demotion and admin reassignment", async () => {
  await installProductionSubscriptionFunctions();
  await pg.query("UPDATE profiles SET role='personal_trainer' WHERE id=$1", [
    USER,
  ]);
  const coach = await issue({ tierName: "coach" });
  const c = await service.prepare(
    USER,
    coach.codes[0].code,
    "user@example.test",
  );
  expect(await service.redeem(USER, c.challengeId)).toMatchObject({
    tierName: "coach",
  });
  const grantService = new FoundingGrantService();
  expect(
    await grantService.grant(
      {
        email: "admin@example.test",
        tierName: "coach",
        grantKind: "complimentary",
        sendInvite: false,
      },
      ADMIN,
    ),
  ).toMatchObject({ ok: false, error: { code: "protected_account" } });
});
it.each([
  "free",
  "studio",
  "studio_pro",
  "enterprise",
  "small_business",
  "unknown",
])("rejects unsupported grant/voucher tier %s", async (tierName) => {
  await expect(
    issue({ tierName: tierName as BatchInput["tierName"] }),
  ).rejects.toThrow();
  expect(
    await new FoundingGrantService().grant(
      {
        email: "user@example.test",
        tierName,
        grantKind: "complimentary",
        sendInvite: false,
      },
      ADMIN,
    ),
  ).toMatchObject({ ok: false, error: { code: "invalid_tier" } });
});

function directGrantInput() {
  return {
    id: randomUUID(),
    userId: USER,
    email: "user@example.test",
    tierName: "premium" as const,
    months: 12,
    grantKind: "complimentary" as const,
    amountMinor: 0,
    currency: "GBP",
    paymentMethod: null,
    paidAt: null,
    paymentReference: null,
    referralCodeId: null,
    grantedBy: ADMIN,
    notes: null,
  };
}
it.each([
  { role: "admin", deleted: false, kind: "protected_account" },
  { role: "personal_trainer", deleted: false, kind: "coach_demotion" },
  { role: "user", deleted: true, kind: "account_pending_deletion" },
])(
  "rechecks individual grant $kind policy inside its transaction",
  async ({ role, deleted, kind }) => {
    await pg.query("UPDATE profiles SET role=$1,deleted_at=$2 WHERE id=$3", [
      role,
      deleted ? new Date() : null,
      USER,
    ]);
    expect(
      await new FoundingGrantRepository().create(
        directGrantInput(),
        "consumer",
      ),
    ).toMatchObject({ kind });
    expect((await pg.query("SELECT * FROM founding_grants")).rows).toHaveLength(
      0,
    );
  },
);
it("preserves explicit administrator consent for consumer role changes", async () => {
  await installProductionSubscriptionFunctions();
  await pg.query("UPDATE profiles SET role='personal_trainer' WHERE id=$1", [
    USER,
  ]);
  expect(
    await new FoundingGrantRepository().create(
      { ...directGrantInput(), allowRoleChange: true },
      "consumer",
    ),
  ).toMatchObject({ kind: "created" });
  expect(
    (
      await pg.query<{ role: string }>(
        "SELECT role FROM profiles WHERE id=$1",
        [USER],
      )
    ).rows[0].role,
  ).toBe("user");
});
it("does not apply a pending consumer grant after the recipient becomes a coach", async () => {
  const grants = new FoundingGrantRepository();
  const created = await grants.create(
    { ...directGrantInput(), userId: null },
    "consumer",
  );
  expect(created.kind).toBe("created");
  if (created.kind !== "created") throw new Error("Fixture failed");
  await pg.query("UPDATE profiles SET role='personal_trainer' WHERE id=$1", [
    USER,
  ]);
  expect(await grants.applyPending(created.grant.id, USER)).toMatchObject({
    applied: false,
  });
  expect(
    (
      await pg.query<{ applied_at: Date | null }>(
        "SELECT applied_at FROM founding_grants",
      )
    ).rows[0].applied_at,
  ).toBeNull();
});
it("does not replace a live direct Stripe subscription with an individual grant", async () => {
  await pg.query(
    "INSERT INTO user_subscriptions(user_id,tier_name,payment_status,expires_at,external_subscription_id) VALUES($1,'premium','active',now()+interval '1 month','sub_paid')",
    [USER],
  );
  expect(
    await new FoundingGrantRepository().create(directGrantInput(), "consumer"),
  ).toMatchObject({ kind: "active_store_subscription" });
});

it("reports individual grant lifecycle, account lookup and aggregate summaries", async () => {
  const grants = new FoundingGrantRepository();
  const input = directGrantInput();
  const result = await grants.create(input, "consumer");
  expect(result.kind).toBe("created");
  expect(await grants.findById(input.id)).toMatchObject({ id: input.id });
  expect(await grants.findById(randomUUID())).toBeNull();
  expect(await grants.findProfileById(randomUUID())).toBeNull();
  expect(await grants.findProfileByEmail("missing@example.test")).toBeNull();
  expect(await grants.tierExists("missing")).toBe(false);
  expect(await grants.hasLiveOrPendingGrantForEmail("USER@EXAMPLE.TEST")).toBe(
    true,
  );
  expect(await grants.hasLiveOrPendingGrantForEmail("missing@test.com")).toBe(
    false,
  );
  expect((await grants.listForUser(USER))[0].status).toBe("active");
  expect(await grants.listForUser(OTHER)).toEqual([]);
  expect(
    await grants.create({ ...input, id: randomUUID() }, "consumer"),
  ).toMatchObject({ kind: "duplicate" });
  await pg.query(
    "UPDATE user_subscriptions SET expires_at=now()-interval '1 day'",
  );
  expect((await grants.list({ revoked: false }))[0].status).toBe("expired");
  expect(await grants.extend(input.id, 2)).toMatchObject({ kind: "extended" });
  await grants.markInvited(input.id);
  expect((await grants.findById(input.id))?.invitedAt).toBeInstanceOf(Date);
  const pending = await grants.create(
    { ...directGrantInput(), userId: null, email: "pending@test.com" },
    "consumer",
  );
  expect(pending.kind).toBe("created");
  expect((await grants.list({})).some((g) => g.status === "pending")).toBe(
    true,
  );
  expect(await grants.summary()).toMatchObject({
    pending: 1,
    contributionMinor: 0,
    byTier: [{ tierName: "premium", count: 2, contributionMinor: 0 }],
  });
  await pg.query("UPDATE founding_grants SET user_id=NULL WHERE id=$1", [
    input.id,
  ]);
  expect((await grants.list({})).find((g) => g.id === input.id)?.status).toBe(
    "account_deleted",
  );
  expect(await grants.extend(input.id, 1)).toEqual({ kind: "account_deleted" });
  expect(await grants.revoke(input.id, "Support correction")).toMatchObject({
    revokeReason: "Support correction",
  });
  expect(await grants.revoke(input.id, "Again")).toBeNull();
  expect(await grants.extend(input.id, 1)).toEqual({ kind: "revoked" });
  expect((await grants.list({ revoked: true }))[0].status).toBe("revoked");
  expect(await grants.extend(randomUUID(), 1)).toEqual({ kind: "not_found" });
});
it("extends pending grants and defers broken or paid subscription extensions safely", async () => {
  const grants = new FoundingGrantRepository();
  const pendingInput = { ...directGrantInput(), userId: null };
  await grants.create(pendingInput, "consumer");
  expect(await grants.extend(pendingInput.id, 3)).toMatchObject({
    kind: "extended",
    expiresAt: null,
    grant: { months: 15 },
  });
  await pg.query("UPDATE founding_grants SET user_id=$1 WHERE id=$2", [
    USER,
    pendingInput.id,
  ]);
  expect(await grants.extend(pendingInput.id, 1)).toEqual({
    kind: "account_deleted",
  });
  await pg.query(
    "UPDATE founding_grants SET subscription_id=NULL,user_id=NULL WHERE id=$1",
    [pendingInput.id],
  );
  await grants.revoke(pendingInput.id, "unused");
  const active = directGrantInput();
  await grants.create(active, "consumer");
  await pg.query(
    "UPDATE user_subscriptions SET external_subscription_id='sub_live'",
  );
  expect(await grants.extend(active.id, 1)).toMatchObject({
    kind: "active_store_subscription",
  });
  await pg.query("UPDATE user_subscriptions SET external_subscription_id=NULL");
  await pg.query("DELETE FROM user_subscriptions");
  expect(await grants.extend(active.id, 1)).toEqual({
    kind: "account_deleted",
  });
});
it("handles exhausted or missing founding pools without creating access", async () => {
  const grants = new FoundingGrantRepository();
  await pg.exec("UPDATE founding_pool_limits SET cap=0 WHERE pool='consumer'");
  expect(
    await grants.create(
      { ...directGrantInput(), grantKind: "founding" },
      "consumer",
    ),
  ).toMatchObject({ kind: "pool_full" });
  expect(
    await grants.reserveSeatUnderPoolLock("consumer", async () => "refused"),
  ).toBe("refused");
  expect(
    await grants.reserveSeatUnderPoolLock("consumer", async () => ({
      held: 0,
      reserve: async () => "unexpected",
    })),
  ).toBe("pool_full");
  expect(
    await grants.freeSeatsWithHolds("consumer", async () => 2),
  ).toMatchObject({ free: 0, held: 2 });
  await pg.exec("DELETE FROM founding_pool_limits WHERE pool='consumer'");
  await expect(grants.seatsForPool("consumer")).rejects.toThrow(
    "Missing founding pool",
  );
  await expect(
    grants.freeSeatsWithHolds("consumer", async () => 0),
  ).rejects.toThrow("Missing founding pool");
  await expect(
    grants.reserveSeatUnderPoolLock("consumer", async () => ({
      held: 0,
      reserve: async () => 1,
    })),
  ).rejects.toThrow("Missing founding pool");
  await expect(
    grants.create({ ...directGrantInput(), grantKind: "founding" }, "consumer"),
  ).rejects.toThrow("Missing founding pool");
  expect(
    (await pg.query("SELECT * FROM user_subscriptions")).rows,
  ).toHaveLength(0);
});
it("pending application is idempotent and ignores nonexistent grants and protected recipients", async () => {
  const grants = new FoundingGrantRepository();
  expect(await grants.applyPending(randomUUID(), USER)).toMatchObject({
    applied: false,
  });
  const pending = { ...directGrantInput(), userId: null };
  await grants.create(pending, "consumer");
  await pg.query("UPDATE profiles SET role='admin' WHERE id=$1", [USER]);
  expect(await grants.applyPending(pending.id, USER)).toMatchObject({
    applied: false,
  });
  await pg.query("UPDATE profiles SET role='user' WHERE id=$1", [USER]);
  expect(await grants.applyPending(pending.id, USER)).toMatchObject({
    applied: true,
  });
  expect(await grants.applyPending(pending.id, USER)).toMatchObject({
    applied: false,
  });
  expect(
    (await pg.query("SELECT * FROM user_subscriptions")).rows,
  ).toHaveLength(1);
});
