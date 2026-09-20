import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";
import { readFileSync } from "node:fs";
vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { FoundingClaimRepository } from "../foundingClaimRepository";
import { FoundingGrantService } from "../../founding/foundingGrantService";
import { claimHash } from "../../founding/foundingClaimService";
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
describe("founding purchase-email claims", () => {
  let pg: PGlite;
  const repo = new FoundingClaimRepository();
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
    await pg.exec(migration("20260920121000_founding_claim_challenges.sql"));
    await pg.exec(
      "UPDATE profiles SET email='relay@privaterelay.appleid.com' WHERE role='user'",
    );
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

  const account = { id: USER, email: "relay@privaterelay.appleid.com" };
  const challenge = "00000000-0000-4000-8000-000000000044";
  const hash = claimHash(`${challenge}:123456`);
  const prepare = () =>
    repo.prepare(account, "user@example.test", challenge, hash);
  const consume = (code = hash) =>
    repo.consume(account, challenge, code, (grant, tx) =>
      new FoundingGrantService().applyPendingGrant(grant, USER, tx),
    );
  it("links a verified purchase email to an Apple relay account, preserving original payment and place", async () => {
    await create(true);
    const before = await new FoundingGrantRepository().findById(ID);
    await prepare();
    expect(await consume()).toMatchObject({
      claimed: true,
      tierName: "premium",
      expiresAt: expect.any(Date),
    });
    const after = await new FoundingGrantRepository().findById(ID);
    expect(after).toMatchObject({
      email: before!.email,
      paymentReference: before!.paymentReference,
      amountMinor: before!.amountMinor,
      months: before!.months,
      userId: USER,
    });
    expect(
      (await new FoundingGrantRepository().seatsForPool("consumer")).used,
    ).toBe(1);
    expect(
      (await pg.query("SELECT email FROM profiles WHERE id=$1", [USER])).rows,
    ).toEqual([{ email: account.email }]);
    expect(
      (
        await pg.query(
          "SELECT otp_hash,completed_at FROM founding_claim_challenges",
        )
      ).rows,
    ).toEqual([{ otp_hash: null, completed_at: expect.any(Date) }]);
    expect(
      (await new AdminAuditRepository().list({ entityId: ID })).map(
        (x) => x.action,
      ),
    ).toContain("founding_grant.claim_verified_email");
  });
  it("replays successful completion without extending the paid term", async () => {
    await create(true);
    await prepare();
    const first = await consume();
    expect(await consume()).toEqual(first);
    expect(
      (await pg.query("SELECT count(*)::int AS n FROM user_subscriptions"))
        .rows,
    ).toEqual([{ n: 1 }]);
  });
  it("stores wrong attempts and locks out after five even with the correct code", async () => {
    await create(true);
    await prepare();
    for (let i = 0; i < 5; i++)
      await expect(consume("wrong")).rejects.toMatchObject({
        code: "invalid_claim",
      });
    await expect(consume()).rejects.toMatchObject({ code: "invalid_claim" });
    expect(
      (await pg.query("SELECT attempts FROM founding_claim_challenges")).rows,
    ).toEqual([{ attempts: 5 }]);
    expect(
      (await new FoundingGrantRepository().findById(ID))?.userId,
    ).toBeNull();
  });
  it("rejects a challenge owned by a different account or changed email", async () => {
    await create(true);
    await prepare();
    const apply = vi.fn();
    await expect(
      repo.consume({ id: ADMIN, email: account.email }, challenge, hash, apply),
    ).rejects.toMatchObject({ code: "invalid_claim" });
    await expect(
      repo.consume(
        { ...account, email: "changed@example.test" },
        challenge,
        hash,
        apply,
      ),
    ).rejects.toMatchObject({ code: "invalid_claim" });
    expect(apply).not.toHaveBeenCalled();
  });
  it("rejects an expired proof and missing challenge", async () => {
    await expect(consume()).rejects.toMatchObject({ code: "invalid_claim" });
    await create(true);
    await prepare();
    await pg.exec(
      "UPDATE founding_claim_challenges SET expires_at=now()-interval '1 second'",
    );
    await expect(consume()).rejects.toMatchObject({ code: "invalid_claim" });
  });
  it("does not reveal or grant absent purchases until email is verified", async () => {
    await prepare();
    await expect(consume("wrong")).rejects.toMatchObject({
      code: "invalid_claim",
    });
    await expect(consume()).rejects.toMatchObject({
      code: "grant_unavailable",
    });
  });
  it.each([
    "UPDATE founding_grants SET revoked_at=now()",
    "UPDATE founding_grants SET email='someone@example.test'",
    "UPDATE founding_grants SET user_id='00000000-0000-4000-8000-000000000001',applied_at=now()",
  ])("rejects a grant changed after challenge issuance: %s", async (sql) => {
    await create(true);
    await prepare();
    await pg.exec(sql);
    await expect(consume()).rejects.toMatchObject({
      code: "grant_unavailable",
    });
  });
  it("does not offer already-attached grants for transfer", async () => {
    await create();
    await prepare();
    await expect(consume()).rejects.toMatchObject({
      code: "grant_unavailable",
    });
  });
  it.each(["rc_store", "sub_stripe", "voucher_existing", "founding_existing"])(
    "preserves paid membership %s",
    async (external) => {
      await create(true);
      await prepare();
      await pg.query(
        "INSERT INTO user_subscriptions(user_id,tier_name,payment_status,expires_at,external_subscription_id) VALUES ($1,'premium_plus','active',now()+interval '1 month',$2)",
        [USER, external],
      );
      await expect(consume()).rejects.toMatchObject({
        code: "subscription_conflict",
      });
      expect(
        (await new FoundingGrantRepository().findById(ID))?.userId,
      ).toBeNull();
    },
  );
  it("refuses another pending grant for the account email", async () => {
    await create(true);
    await prepare();
    await pg.query(
      "INSERT INTO founding_grants(email,tier_name,months,granted_by) VALUES ($1,'premium',6,$2)",
      [account.email, ADMIN],
    );
    await expect(consume()).rejects.toMatchObject({
      code: "subscription_conflict",
    });
  });
  it.each([
    "UPDATE profiles SET role='admin' WHERE role='user'",
    "UPDATE profiles SET role='personal_trainer' WHERE role='user'",
    "UPDATE profiles SET deleted_at=now() WHERE role='user'",
  ])("protects incompatible accounts: %s", async (sql) => {
    await create(true);
    await prepare();
    await pg.exec(sql);
    await expect(consume()).rejects.toMatchObject({ code: "account_conflict" });
  });
  it("rolls back activation and proof consumption if audit fails", async () => {
    await create(true);
    await prepare();
    vi.spyOn(AdminAuditRepository.prototype, "record").mockRejectedValue(
      new Error("audit failed"),
    );
    await expect(consume()).rejects.toThrow("audit failed");
    expect(
      (await new FoundingGrantRepository().findById(ID))?.userId,
    ).toBeNull();
    expect(
      (await pg.query("SELECT completed_at FROM founding_claim_challenges"))
        .rows,
    ).toEqual([{ completed_at: null }]);
  });
  it("rejects replay after refund/revocation", async () => {
    await create(true);
    await prepare();
    await consume();
    await new FoundingGrantRepository().revoke(ID, "refund");
    await expect(consume()).rejects.toMatchObject({ code: "invalid_claim" });
  });
  it("rejects old completed proof and cleans expired challenges", async () => {
    await create(true);
    await prepare();
    await consume();
    await pg.exec(
      "UPDATE founding_claim_challenges SET completed_at=now()-interval '31 days'",
    );
    await expect(consume()).rejects.toMatchObject({ code: "invalid_claim" });
    await repo.prepare(
      account,
      "none@example.test",
      "00000000-0000-4000-8000-000000000045",
      hash,
    );
    expect(
      (
        await pg.query(
          "SELECT count(*)::int AS n FROM founding_claim_challenges",
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("deletes a failed-delivery proof", async () => {
    await prepare();
    await repo.discard(challenge);
    await expect(consume()).rejects.toMatchObject({ code: "invalid_claim" });
  });
  it("new migration can be applied again and is private", async () => {
    await pg.exec(migration("20260920121000_founding_claim_challenges.sql"));
    expect(
      (
        await pg.query(
          "SELECT relrowsecurity FROM pg_class WHERE relname='founding_claim_challenges'",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true }]);
    expect(
      (
        await pg.query(
          "SELECT has_table_privilege('authenticated', 'founding_claim_challenges', 'SELECT') AS allowed",
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
  });
});
