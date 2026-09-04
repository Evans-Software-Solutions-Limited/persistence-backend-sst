import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";
import { readFileSync } from "node:fs";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { AdminAuditRepository } from "../adminAuditRepository";
import { FoundingGrantRepository } from "../foundingGrantRepository";
import { ReferralRepository } from "../referralRepository";
import { SubscriptionRepository } from "../subscriptionRepository";
import { FoundingGrantService } from "../../founding/foundingGrantService";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";

describe("founding/referral repository transaction invariants", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    pg = await PGlite.create();
    db = drizzle(pg, { schema });
    vi.mocked(getDb).mockReturnValue(db as never);
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
    const migration = readFileSync(
      new URL(
        "../../../../../../supabase/migrations/20260904120000_founding_offer_referrals.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pg.exec(migration);
  });

  afterEach(async () => {
    await pg.close();
    vi.restoreAllMocks();
  });

  async function createCode(
    code: string,
    maxRedemptions: number | null = null,
  ) {
    return new ReferralRepository().createCode({
      code,
      displayCode: code,
      label: code,
      kind: "campaign",
      maxRedemptions,
      createdBy: ADMIN,
    });
  }

  it("keeps a same-code retry unchanged when that user filled the cap", async () => {
    const repo = new ReferralRepository();
    await createCode("FINAL", 1);

    expect(
      (
        await repo.claim({
          userId: USER,
          canonicalCode: "FINAL",
          source: "app",
        })
      ).kind,
    ).toBe("applied");
    expect(
      (
        await repo.claim({
          userId: USER,
          canonicalCode: "FINAL",
          source: "app",
        })
      ).kind,
    ).toBe("unchanged");

    const counts = await pg.query<{ code: string; redemption_count: number }>(
      "SELECT code, redemption_count FROM referral_codes",
    );
    expect(counts.rows).toEqual([{ code: "FINAL", redemption_count: 1 }]);
  });

  it("leaves a pending founding seat unconsumed when a store write wins the user lock", async () => {
    const grants = new FoundingGrantRepository();
    const subscriptions = new SubscriptionRepository();
    const grantId = "00000000-0000-4000-8000-000000000070";
    await grants.create(
      {
        id: grantId,
        userId: null,
        email: "user@example.test",
        tierName: "premium",
        months: 6,
        amountMinor: 3000,
        currency: "GBP",
        paymentMethod: "bank_transfer",
        paymentReference: null,
        paidAt: new Date(),
        referralCodeId: null,
        grantedBy: ADMIN,
        notes: null,
      },
      "consumer",
    );

    let releaseStore!: () => void;
    const storeMayCommit = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    let storeHasLock!: () => void;
    const storeLocked = new Promise<void>((resolve) => {
      storeHasLock = resolve;
    });
    const storeWrite = subscriptions.withUserSubscriptionLock(
      USER,
      async (transaction) => {
        storeHasLock();
        await storeMayCommit;
        await subscriptions.upsertByExternalId(
          {
            userId: USER,
            tierName: "premium",
            paymentStatus: "active",
            startsAt: new Date(),
            expiresAt: new Date("2027-01-01T00:00:00.000Z"),
            externalSubscriptionId: `rc_${USER}`,
          },
          transaction,
        );
      },
    );
    await storeLocked;

    let applySettled = false;
    const applying = grants.applyPending(grantId, USER).finally(() => {
      applySettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(applySettled).toBe(false);

    releaseStore();
    await storeWrite;
    const result = await applying;
    expect(result).toMatchObject({
      applied: false,
      storeSubscription: { tierName: "premium" },
    });
    const rows = await pg.query<{
      user_id: string | null;
      applied_at: string | null;
      subscription_id: string | null;
    }>(
      "SELECT user_id, applied_at, subscription_id FROM founding_grants WHERE id = $1",
      [grantId],
    );
    expect(rows.rows[0]).toEqual({
      user_id: null,
      applied_at: null,
      subscription_id: null,
    });

    const immediate = await grants.create(
      {
        id: "00000000-0000-4000-8000-000000000071",
        userId: USER,
        email: "user@example.test",
        tierName: "premium",
        months: 6,
        amountMinor: 3000,
        currency: "GBP",
        paymentMethod: "bank_transfer",
        paymentReference: null,
        paidAt: new Date(),
        referralCodeId: null,
        grantedBy: ADMIN,
        notes: null,
      },
      "consumer",
    );
    expect(immediate).toMatchObject({
      kind: "active_store_subscription",
      subscription: { tierName: "premium" },
    });
  });

  it("linearizes a later store write after a founding application that owns the user lock", async () => {
    const secondUser = "00000000-0000-4000-8000-000000000072";
    const grantId = "00000000-0000-4000-8000-000000000073";
    await pg.query(
      "INSERT INTO profiles (id, email, role) VALUES ($1, 'second@example.test', 'user')",
      [secondUser],
    );
    const grants = new FoundingGrantRepository();
    const subscriptions = new SubscriptionRepository();
    await grants.create(
      {
        id: grantId,
        userId: null,
        email: "second@example.test",
        tierName: "premium",
        months: 6,
        amountMinor: 3000,
        currency: "GBP",
        paymentMethod: "bank_transfer",
        paymentReference: null,
        paidAt: new Date(),
        referralCodeId: null,
        grantedBy: ADMIN,
        notes: null,
      },
      "consumer",
    );

    let releaseFounding!: () => void;
    const foundingMayCommit = new Promise<void>((resolve) => {
      releaseFounding = resolve;
    });
    let foundingHasLock!: () => void;
    const foundingLocked = new Promise<void>((resolve) => {
      foundingHasLock = resolve;
    });
    const applying = grants.applyPending(grantId, secondUser, async () => {
      foundingHasLock();
      await foundingMayCommit;
    });
    await foundingLocked;

    let storeSettled = false;
    const storeWrite = subscriptions
      .withUserSubscriptionLock(secondUser, async (transaction) => {
        await subscriptions.cancelLiveSubscriptions(secondUser, transaction);
        await subscriptions.upsertByExternalId(
          {
            userId: secondUser,
            tierName: "premium",
            paymentStatus: "active",
            startsAt: new Date(),
            expiresAt: new Date("2027-01-01T00:00:00.000Z"),
            externalSubscriptionId: `rc_${secondUser}`,
          },
          transaction,
        );
      })
      .finally(() => {
        storeSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storeSettled).toBe(false);

    releaseFounding();
    expect((await applying).applied).toBe(true);
    await storeWrite;
    const live = await pg.query<{ external_subscription_id: string }>(
      `SELECT external_subscription_id FROM user_subscriptions
       WHERE user_id = $1 AND payment_status = 'active'`,
      [secondUser],
    );
    expect(live.rows).toEqual([
      { external_subscription_id: `rc_${secondUser}` },
    ]);
  });

  it("serializes a purchase lock against replacement and preserves honest counters", async () => {
    const repo = new ReferralRepository();
    await createCode("CODEA");
    await createCode("CODEB");
    await repo.claim({ userId: USER, canonicalCode: "CODEA", source: "app" });

    await Promise.all([
      repo.lock(USER),
      repo.claim({ userId: USER, canonicalCode: "CODEB", source: "app" }),
    ]);

    const redemption = await pg.query<{
      code: string;
      locked_at: string | null;
    }>(`SELECT c.code, r.locked_at
        FROM referral_redemptions r
        JOIN referral_codes c ON c.id = r.code_id
        WHERE r.user_id = '${USER}'`);
    expect(redemption.rows).toHaveLength(1);
    expect(redemption.rows[0].locked_at).not.toBeNull();
    const counts = await pg.query<{ code: string; redemption_count: number }>(
      "SELECT code, redemption_count FROM referral_codes ORDER BY code",
    );
    expect(counts.rows).toEqual(
      redemption.rows[0].code === "CODEA"
        ? [
            { code: "CODEA", redemption_count: 1 },
            { code: "CODEB", redemption_count: 0 },
          ]
        : [
            { code: "CODEA", redemption_count: 0 },
            { code: "CODEB", redemption_count: 1 },
          ],
    );
  });

  it("rejects paused, future, expired and exhausted codes as ineligible", async () => {
    const repo = new ReferralRepository();
    const paused = await createCode("PAUSED");
    const future = await createCode("FUTURE");
    const expired = await createCode("EXPIRED");
    const full = await createCode("FULL", 0);
    await pg.query(
      "UPDATE referral_codes SET status = 'paused' WHERE id = $1",
      [paused.id],
    );
    await pg.query(
      "UPDATE referral_codes SET starts_at = now() + interval '1 day' WHERE id = $1",
      [future.id],
    );
    await pg.query(
      "UPDATE referral_codes SET ends_at = now() - interval '1 day' WHERE id = $1",
      [expired.id],
    );

    for (const code of [paused, future, expired, full]) {
      expect(await repo.isCodeEligible(code.id)).toBe(false);
    }
  });

  it("reserves the last capped referral for one pending sale and applies it atomically", async () => {
    const referrals = new ReferralRepository();
    const grants = new FoundingGrantRepository();
    const audit = new AdminAuditRepository();
    const code = await createCode("RESERVED", 1);
    const grantInput = (id: string, email: string) => ({
      id,
      userId: null,
      email,
      tierName: "premium" as const,
      months: 6,
      amountMinor: 3000,
      currency: "GBP",
      paymentMethod: "bank_transfer" as const,
      paymentReference: null,
      paidAt: new Date(),
      referralCodeId: code.id,
      grantedBy: ADMIN,
      notes: null,
    });
    const firstId = "00000000-0000-4000-8000-000000000030";
    const secondId = "00000000-0000-4000-8000-000000000031";

    await grants.create(
      grantInput(firstId, "first@example.test"),
      "consumer",
      async ({ transaction }) => {
        expect(
          await referrals.isCodeEligibleForPendingGrant(
            code.id,
            firstId,
            transaction,
          ),
        ).toBe(true);
      },
    );
    await expect(
      grants.create(
        grantInput(secondId, "second@example.test"),
        "consumer",
        async ({ transaction }) => {
          if (
            !(await referrals.isCodeEligibleForPendingGrant(
              code.id,
              secondId,
              transaction,
            ))
          ) {
            throw new Error("reserved cap exhausted");
          }
        },
      ),
    ).rejects.toThrow("reserved cap exhausted");

    await expect(
      grants.applyPending(firstId, USER, async ({ transaction }) => {
        const outcome = await referrals.claim(
          {
            userId: USER,
            canonicalCode: code.code,
            source: "admin",
            reservedCodeId: code.id,
          },
          transaction,
        );
        expect(outcome.kind).toBe("applied");
        await referrals.lock(USER, transaction);
        await audit.record(
          {
            actorId: null as never,
            action: "founding_grant.apply_pending",
            entityType: "founding_grant",
          },
          transaction,
        );
      }),
    ).rejects.toThrow();
    expect(
      (
        await pg.query<{ user_id: string | null }>(
          "SELECT user_id FROM founding_grants WHERE id = $1",
          [firstId],
        )
      ).rows[0].user_id,
    ).toBeNull();
    expect(
      (await pg.query("SELECT id FROM referral_redemptions")).rows,
    ).toEqual([]);
    expect((await pg.query("SELECT id FROM user_subscriptions")).rows).toEqual(
      [],
    );

    const applied = await grants.applyPending(
      firstId,
      USER,
      async ({ transaction }) => {
        const outcome = await referrals.claim(
          {
            userId: USER,
            canonicalCode: code.code,
            source: "admin",
            reservedCodeId: code.id,
          },
          transaction,
        );
        expect(outcome.kind).toBe("applied");
        await referrals.lock(USER, transaction);
        await audit.record(
          {
            actorId: ADMIN,
            action: "founding_grant.apply_pending",
            entityType: "founding_grant",
            entityId: firstId,
          },
          transaction,
        );
      },
    );
    expect(applied.applied).toBe(true);
    const final = await pg.query<{
      user_id: string;
      redemption_count: number;
      locked_at: string;
    }>(`SELECT g.user_id, c.redemption_count, r.locked_at
        FROM founding_grants g
        JOIN referral_codes c ON c.id = g.referral_code_id
        JOIN referral_redemptions r ON r.user_id = g.user_id
        WHERE g.id = '${firstId}'`);
    expect(final.rows[0]).toMatchObject({
      user_id: USER,
      redemption_count: 1,
    });
    expect(final.rows[0].locked_at).not.toBeNull();
  });

  it("lets an immediate capped grant consume its own slot while retaining the cap boundary", async () => {
    const referrals = new ReferralRepository();
    const grants = new FoundingGrantRepository();
    const audit = new AdminAuditRepository();
    const service = new FoundingGrantService(
      grants,
      referrals,
      audit,
      async () => undefined,
      "https://example.test",
    );
    await createCode("DIRECTCAP", 1);

    const first = await service.grant(
      {
        email: "user@example.test",
        tierName: "premium",
        paymentMethod: "other",
        referralCode: "DIRECTCAP",
        sendInvite: false,
      },
      ADMIN,
    );
    expect(first.ok).toBe(true);
    const counts = await pg.query<{
      grants: number;
      redemptions: number;
      redemption_count: number;
    }>(`SELECT
          (SELECT count(*)::int FROM founding_grants) grants,
          (SELECT count(*)::int FROM referral_redemptions) redemptions,
          redemption_count
        FROM referral_codes WHERE code = 'DIRECTCAP'`);
    expect(counts.rows[0]).toEqual({
      grants: 1,
      redemptions: 1,
      redemption_count: 1,
    });

    const secondUser = "00000000-0000-4000-8000-000000000032";
    await pg.query(
      "INSERT INTO profiles (id, email, role) VALUES ($1, 'second@example.test', 'user')",
      [secondUser],
    );
    const second = await service.grant(
      {
        email: "second@example.test",
        tierName: "premium",
        paymentMethod: "other",
        referralCode: "DIRECTCAP",
        sendInvite: false,
      },
      ADMIN,
    );
    expect(second).toEqual({
      ok: false,
      error: { code: "invalid_referral_code" },
    });
    expect(
      (await pg.query("SELECT id FROM founding_grants")).rows,
    ).toHaveLength(1);
  });

  it("consumes paid reservations after the code is paused, archived or expired", async () => {
    const referrals = new ReferralRepository();
    const grants = new FoundingGrantRepository();
    const cases = [
      {
        code: "PAIDPAUSED",
        userId: "00000000-0000-4000-8000-000000000041",
        mutation: "status = 'paused'",
      },
      {
        code: "PAIDARCHIVED",
        userId: "00000000-0000-4000-8000-000000000042",
        mutation: "status = 'archived'",
      },
      {
        code: "PAIDEXPIRED",
        userId: "00000000-0000-4000-8000-000000000043",
        mutation: "ends_at = now() - interval '1 day'",
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      await pg.query(
        "INSERT INTO profiles (id, email, role) VALUES ($1, $2, 'user')",
        [testCase.userId, `${testCase.code.toLowerCase()}@example.test`],
      );
      const code = await createCode(testCase.code, 1);
      const grantId = `00000000-0000-4000-8000-${String(50 + index).padStart(12, "0")}`;
      await grants.create(
        {
          id: grantId,
          userId: null,
          email: `${testCase.code.toLowerCase()}@example.test`,
          tierName: "premium",
          months: 6,
          amountMinor: 3000,
          currency: "GBP",
          paymentMethod: "bank_transfer",
          paymentReference: null,
          paidAt: new Date(),
          referralCodeId: code.id,
          grantedBy: ADMIN,
          notes: null,
        },
        "consumer",
        async ({ transaction }) => {
          expect(
            await referrals.isCodeEligibleForPendingGrant(
              code.id,
              grantId,
              transaction,
            ),
          ).toBe(true);
        },
      );
      await pg.query(
        `UPDATE referral_codes SET ${testCase.mutation} WHERE id = $1`,
        [code.id],
      );

      const result = await grants.applyPending(
        grantId,
        testCase.userId,
        async ({ transaction }) => {
          const claim = await referrals.claim(
            {
              userId: testCase.userId,
              canonicalCode: code.code,
              source: "admin",
              reservedCodeId: code.id,
            },
            transaction,
          );
          expect(claim.kind).toBe("applied");
          await referrals.lock(testCase.userId, transaction);
        },
      );
      expect(result.applied).toBe(true);
    }
  });

  it("preserves a locked conflict without releasing the paid code reservation", async () => {
    const referrals = new ReferralRepository();
    const grants = new FoundingGrantRepository();
    const reserved = await createCode("PAIDLOCKED", 1);
    await createCode("EXISTING");
    const grantId = "00000000-0000-4000-8000-000000000060";
    await grants.create(
      {
        id: grantId,
        userId: null,
        email: "user@example.test",
        tierName: "premium",
        months: 6,
        amountMinor: 3000,
        currency: "GBP",
        paymentMethod: "bank_transfer",
        paymentReference: null,
        paidAt: new Date(),
        referralCodeId: reserved.id,
        grantedBy: ADMIN,
        notes: null,
      },
      "consumer",
      async ({ transaction }) => {
        expect(
          await referrals.isCodeEligibleForPendingGrant(
            reserved.id,
            grantId,
            transaction,
          ),
        ).toBe(true);
      },
    );
    await referrals.claim({
      userId: USER,
      canonicalCode: "EXISTING",
      source: "app",
    });
    await referrals.lock(USER);

    const applied = await grants.applyPending(
      grantId,
      USER,
      async ({ transaction }) => {
        const claim = await referrals.claim(
          {
            userId: USER,
            canonicalCode: reserved.code,
            source: "admin",
            reservedCodeId: reserved.id,
          },
          transaction,
        );
        expect(claim.kind).toBe("locked");
      },
    );
    expect(applied.applied).toBe(true);
    const newcomer = "00000000-0000-4000-8000-000000000061";
    await pg.query(
      "INSERT INTO profiles (id, email, role) VALUES ($1, 'new@example.test', 'user')",
      [newcomer],
    );
    expect(
      (
        await referrals.claim({
          userId: newcomer,
          canonicalCode: reserved.code,
          source: "app",
        })
      ).kind,
    ).toBe("invalid");
    const count = await pg.query<{ redemption_count: number }>(
      "SELECT redemption_count FROM referral_codes WHERE id = $1",
      [reserved.id],
    );
    expect(count.rows[0].redemption_count).toBe(0);
  });

  it("rolls back manual attribution when its serialized audit callback fails", async () => {
    const referrals = new ReferralRepository();
    const audit = new AdminAuditRepository();
    await createCode("MANUAL");

    await expect(
      referrals.claim(
        { userId: USER, canonicalCode: "MANUAL", source: "admin" },
        undefined,
        (_before, _outcome, transaction) =>
          audit.record(
            {
              actorId: null as never,
              action: "referral_attribution.set",
              entityType: "user",
            },
            transaction,
          ),
      ),
    ).rejects.toThrow();
    expect(
      (await pg.query("SELECT id FROM referral_redemptions")).rows,
    ).toEqual([]);
    expect(
      (
        await pg.query<{ redemption_count: number }>(
          "SELECT redemption_count FROM referral_codes WHERE code = 'MANUAL'",
        )
      ).rows[0].redemption_count,
    ).toBe(0);
  });

  it("serializes concurrent manual reassignments and gives each audit its true before-state", async () => {
    const referrals = new ReferralRepository();
    await createCode("ORIGINAL");
    await createCode("OPTIONB");
    await createCode("OPTIONC");
    await referrals.claim({
      userId: USER,
      canonicalCode: "ORIGINAL",
      source: "admin",
    });
    const transitions: Array<{ before: string | null; after: string }> = [];

    await Promise.all(
      ["OPTIONB", "OPTIONC"].map((canonicalCode) =>
        referrals.claim(
          { userId: USER, canonicalCode, source: "admin" },
          undefined,
          async (before, outcome) => {
            transitions.push({
              before: before?.code ?? null,
              after: outcome.applied.code,
            });
          },
        ),
      ),
    );

    expect(transitions).toHaveLength(2);
    expect(transitions[0].before).toBe("ORIGINAL");
    expect(transitions[1].before).toBe(transitions[0].after);
  });

  it("rolls back a founding grant when its audit insert fails", async () => {
    const grants = new FoundingGrantRepository();
    const audit = new AdminAuditRepository();

    await expect(
      grants.create(
        {
          id: "00000000-0000-4000-8000-000000000010",
          userId: null,
          email: "pending@example.test",
          tierName: "premium",
          months: 6,
          amountMinor: 3000,
          currency: "GBP",
          paymentMethod: "bank_transfer",
          paymentReference: null,
          paidAt: new Date(),
          referralCodeId: null,
          grantedBy: ADMIN,
          notes: null,
        },
        "consumer",
        ({ transaction }) =>
          audit.record(
            {
              actorId: null as never,
              action: "founding_grant.create",
              entityType: "founding_grant",
            },
            transaction,
          ),
      ),
    ).rejects.toThrow();

    const grantsAfter = await pg.query("SELECT id FROM founding_grants");
    expect(grantsAfter.rows).toEqual([]);
  });

  it("retains an applied grant after account deletion without reapplying it", async () => {
    const grants = new FoundingGrantRepository();
    expect(await grants.findProfileById(USER)).toMatchObject({
      id: USER,
      deletedAt: null,
    });
    const firstGrantId = "00000000-0000-4000-8000-000000000070";
    const input = {
      id: firstGrantId,
      userId: USER,
      email: "user@example.test",
      tierName: "premium" as const,
      months: 6,
      amountMinor: 3000,
      currency: "GBP",
      paymentMethod: "other" as const,
      paymentReference: null,
      paidAt: new Date(),
      referralCodeId: null,
      grantedBy: ADMIN,
      notes: null,
    };
    expect((await grants.create(input, "consumer")).kind).toBe("created");

    await pg.query("DELETE FROM profiles WHERE id = $1", [USER]);

    const retained = await pg.query<{
      user_id: string | null;
      applied_at: string | null;
    }>("SELECT user_id, applied_at FROM founding_grants WHERE id = $1", [
      firstGrantId,
    ]);
    expect(retained.rows[0].user_id).toBeNull();
    expect(retained.rows[0].applied_at).not.toBeNull();
    expect((await grants.list({}))[0].status).toBe("account_deleted");
    expect((await grants.seatsForPool("consumer")).used).toBe(1);

    const replacementUser = "00000000-0000-4000-8000-000000000071";
    await pg.query(
      "INSERT INTO profiles (id, email, role) VALUES ($1, 'user@example.test', 'user')",
      [replacementUser],
    );
    const service = new FoundingGrantService(
      grants,
      new ReferralRepository(),
      new AdminAuditRepository(),
      async () => undefined,
      "https://example.test",
      async () => ({
        id: replacementUser,
        email: "user@example.test",
        emailConfirmedAt: "2026-09-04T08:00:00.000Z",
      }),
    );
    expect(
      await service.applyPendingForUser(replacementUser, "user@example.test"),
    ).toBe(false);

    const replacement = await grants.create(
      {
        ...input,
        id: "00000000-0000-4000-8000-000000000072",
        userId: replacementUser,
      },
      "consumer",
    );
    expect(replacement.kind).toBe("created");
  });

  it("retains the issuer UUID when the granting admin profile is deleted", async () => {
    const grants = new FoundingGrantRepository();
    const id = "00000000-0000-4000-8000-000000000073";
    expect(
      (
        await grants.create(
          {
            id,
            userId: USER,
            email: "user@example.test",
            tierName: "premium",
            months: 6,
            amountMinor: 3000,
            currency: "GBP",
            paymentMethod: "other",
            paymentReference: null,
            paidAt: new Date(),
            referralCodeId: null,
            grantedBy: ADMIN,
            notes: null,
          },
          "consumer",
        )
      ).kind,
    ).toBe("created");

    await expect(
      pg.query("DELETE FROM profiles WHERE id = $1", [ADMIN]),
    ).resolves.toBeDefined();
    const retained = await pg.query<{ granted_by: string }>(
      "SELECT granted_by FROM founding_grants WHERE id = $1",
      [id],
    );
    expect(retained.rows[0].granted_by).toBe(ADMIN);
  });

  it("deduplicates concurrent apply-deferred audits in the database", async () => {
    const audit = new AdminAuditRepository();
    const event = {
      actorId: ADMIN,
      action: "founding_grant.apply_deferred",
      entityType: "founding_grant",
      entityId: "00000000-0000-4000-8000-000000000074",
      after: { userId: USER, reason: "active_store_subscription" },
    };

    await Promise.all([audit.recordOnce(event), audit.recordOnce(event)]);
    const rows = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM admin_audit_log WHERE action = 'founding_grant.apply_deferred' AND entity_id = $1",
      [event.entityId],
    );
    expect(rows.rows[0].count).toBe(1);
  });

  it("rolls back referral-code creation when its audit insert fails", async () => {
    const referrals = new ReferralRepository();
    const audit = new AdminAuditRepository();

    await expect(
      db.transaction(async (transaction) => {
        await referrals.createCodeIn(transaction as never, {
          code: "ATOMIC",
          displayCode: "ATOMIC",
          label: "Atomic",
          kind: "internal",
          createdBy: ADMIN,
        });
        await audit.record(
          {
            actorId: null as never,
            action: "referral_code.create",
            entityType: "referral_code",
          },
          transaction as never,
        );
      }),
    ).rejects.toThrow();

    const codes = await pg.query("SELECT id FROM referral_codes");
    expect(codes.rows).toEqual([]);
  });

  it("rolls back referral-code update and grant revocation when audit insertion fails", async () => {
    const referrals = new ReferralRepository();
    const grants = new FoundingGrantRepository();
    const audit = new AdminAuditRepository();
    const code = await createCode("ROLLBACK");
    const grantId = "00000000-0000-4000-8000-000000000020";
    await grants.create(
      {
        id: grantId,
        userId: null,
        email: "rollback@example.test",
        tierName: "premium",
        months: 6,
        amountMinor: 3000,
        currency: "GBP",
        paymentMethod: "bank_transfer",
        paymentReference: null,
        paidAt: new Date(),
        referralCodeId: null,
        grantedBy: ADMIN,
        notes: null,
      },
      "consumer",
    );

    await expect(
      db.transaction(async (transaction) => {
        await referrals.updateCodeIn(transaction as never, code.id, {
          status: "paused",
        });
        await audit.record(
          {
            actorId: null as never,
            action: "referral_code.update",
            entityType: "referral_code",
          },
          transaction as never,
        );
      }),
    ).rejects.toThrow();
    await expect(
      grants.revoke(grantId, "refund", (_grant, transaction) =>
        audit.record(
          {
            actorId: null as never,
            action: "founding_grant.revoke",
            entityType: "founding_grant",
          },
          transaction,
        ),
      ),
    ).rejects.toThrow();

    const codeAfter = await pg.query<{ status: string }>(
      "SELECT status FROM referral_codes WHERE id = $1",
      [code.id],
    );
    const grantAfter = await pg.query<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM founding_grants WHERE id = $1",
      [grantId],
    );
    expect(codeAfter.rows[0].status).toBe("active");
    expect(grantAfter.rows[0].revoked_at).toBeNull();
  });

  it("rolls back invited-at when the resend audit cannot be written", async () => {
    const grants = new FoundingGrantRepository();
    const audit = new AdminAuditRepository();
    const grantId = "00000000-0000-4000-8000-000000000050";
    await grants.create(
      {
        id: grantId,
        userId: null,
        email: "invite@example.test",
        tierName: "premium",
        months: 6,
        amountMinor: 3000,
        currency: "GBP",
        paymentMethod: "bank_transfer",
        paymentReference: null,
        paidAt: new Date(),
        referralCodeId: null,
        grantedBy: ADMIN,
        notes: null,
      },
      "consumer",
    );

    await expect(
      grants.markInvited(grantId, (transaction) =>
        audit.record(
          {
            actorId: null as never,
            action: "founding_grant.resend_invite",
            entityType: "founding_grant",
            entityId: grantId,
            after: { ok: true },
          },
          transaction,
        ),
      ),
    ).rejects.toThrow();

    const grant = await pg.query<{ invited_at: string | null }>(
      "SELECT invited_at FROM founding_grants WHERE id = $1",
      [grantId],
    );
    expect(grant.rows[0].invited_at).toBeNull();
  });
});
