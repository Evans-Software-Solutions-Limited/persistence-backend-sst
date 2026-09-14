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
