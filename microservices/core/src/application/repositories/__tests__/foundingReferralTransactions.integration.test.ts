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
        role text
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
        billing_cycle text,
        external_subscription_id text,
        metadata jsonb,
        updated_at timestamptz DEFAULT now()
      );
      INSERT INTO profiles (id, email, role) VALUES
        ('${ADMIN}', 'admin@example.test', 'admin'),
        ('${USER}', 'user@example.test', 'user');
      INSERT INTO subscription_tiers (tier_name, display_name)
        VALUES ('premium', 'Premium');
    `);
    const migration = readFileSync(
      new URL(
        "../../../../../../supabase/migrations/20260903120000_founding_offer_referrals.sql",
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
});
