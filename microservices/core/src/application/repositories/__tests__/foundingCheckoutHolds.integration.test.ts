import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";
import { readFileSync } from "node:fs";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { FoundingCheckoutRepository } from "../foundingCheckoutRepository";
import { FoundingGrantRepository } from "../foundingGrantRepository";

const ADMIN = "00000000-0000-4000-8000-000000000001";

const migrationSql = (file: string): string =>
  readFileSync(
    new URL(`../../../../../../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );

const FOUNDING_MIGRATION = migrationSql(
  "20260904120000_founding_offer_referrals.sql",
);
const GENERALISE_MIGRATION = migrationSql(
  "20260904214114_generalise_founding_grants.sql",
);
const CHECKOUT_MIGRATION = migrationSql(
  "20260905140000_founding_checkout_sessions.sql",
);

/**
 * The seat hold, against a real Postgres.
 *
 * This is the whole reason `founding_checkout_sessions` exists, and every part
 * of it is SQL: a partial count filtered on status AND an expiry instant AND
 * the pool's tiers, added to a grant count inside one advisory-locked
 * transaction. Under a mocked `getDb` all of that renders and returns whatever
 * the mock was told to — which is how you ship a pool that oversells.
 */
describe("founding pool seats, with checkouts in flight", () => {
  let pg: PGlite;
  const grants = new FoundingGrantRepository();
  const checkouts = new FoundingCheckoutRepository();

  beforeEach(async () => {
    pg = await PGlite.create();
    vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
    await pg.exec(`
      CREATE TABLE profiles (id uuid PRIMARY KEY, email text, role text, deleted_at timestamptz);
      CREATE TABLE subscription_tiers (tier_name text PRIMARY KEY, display_name text);
      CREATE TABLE user_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      INSERT INTO profiles (id, email) VALUES ('${ADMIN}', 'admin@example.test');
      INSERT INTO subscription_tiers (tier_name, display_name) VALUES
        ('premium', 'Premium'), ('premium_plus', 'Premium+'),
        ('start_up_coach_plus', 'Start Up Coach+');
    `);
    await pg.exec(FOUNDING_MIGRATION);
    await pg.exec(GENERALISE_MIGRATION);
    await pg.exec(CHECKOUT_MIGRATION);
    // Small caps make the arithmetic readable.
    await pg.query(
      `UPDATE founding_pool_limits SET cap = 3 WHERE pool = 'consumer'`,
    );
    await pg.query(
      `UPDATE founding_pool_limits SET cap = 2 WHERE pool = 'coach'`,
    );
  });

  afterEach(async () => {
    await pg.close();
    vi.restoreAllMocks();
  });

  /**
   * Reserve a seat and bind it to `sessionId`, the way the route does — the
   * hold is taken under the pool lock BEFORE Stripe is called, then the real
   * Session id is attached.
   */
  async function openCheckout(
    tierName: string,
    holdMinutes: number,
    sessionId = `cs_${Math.random().toString(36).slice(2)}`,
    email = `${sessionId}@example.test`,
  ) {
    const row = await grants.reserveSeatUnderPoolLock(
      tierName === "start_up_coach_plus" ? "coach" : "consumer",
      async (tx) => ({
        held: await checkouts.countHeldInPool(
          tx,
          tierName === "start_up_coach_plus" ? "coach" : "consumer",
          new Date(),
        ),
        reserve: () =>
          checkouts.reserveIn(tx, {
            email,
            tierName,
            months: 6,
            referralCode: null,
            campaignSlug: null,
            holdExpiresAt: new Date(Date.now() + holdMinutes * 60 * 1000),
            eventId: null,
            fbc: null,
            fbp: null,
            marketingConsent: false,
          }),
      }),
    );
    if (typeof row === "string") throw new Error(row);
    await checkouts.attachStripeSession(
      row.id,
      sessionId,
      3000,
      "GBP",
      new Date(Date.now() + holdMinutes * 60 * 1000),
    );
    return { ...row, stripeSessionId: sessionId };
  }

  async function addGrant(tierName: string, revoked = false) {
    await pg.query(
      `INSERT INTO founding_grants (email, tier_name, months, grant_kind, granted_by, revoked_at, revoke_reason)
       VALUES ($1, $2, 6, 'founding', $3, $4, $5)`,
      [
        `${Math.random().toString(36).slice(2)}@example.test`,
        tierName,
        ADMIN,
        revoked ? new Date().toISOString() : null,
        revoked ? "test" : null,
      ],
    );
  }

  const free = () =>
    grants.freeSeatsWithHolds("consumer", (tx) =>
      checkouts.countHeldInPool(tx, "consumer", new Date()),
    );

  it("counts zero when no checkout has ever been started", async () => {
    // The aggregate always returns a row, but the `?? 0` guard is what keeps a
    // missing one from turning the seat count into NaN.
    expect(await free()).toMatchObject({ used: 0, held: 0, cap: 3, free: 3 });
  });

  it("returns null for a Stripe session id we have no record of", async () => {
    expect(await checkouts.findByStripeSessionId("cs_never_seen")).toBeNull();
  });

  it("counts an open, unexpired checkout as a seat taken", async () => {
    await openCheckout("premium", 30);
    expect(await free()).toMatchObject({ used: 0, held: 1, cap: 3, free: 2 });
  });

  it("adds holds to grants", async () => {
    await addGrant("premium");
    await addGrant("premium_plus");
    await openCheckout("premium", 30);
    expect(await free()).toMatchObject({ used: 2, held: 1, cap: 3, free: 0 });
  });

  it("stops counting a hold the moment it lapses", async () => {
    // The self-healing property: an abandoned checkout frees its seat with no
    // sweeper and no dependence on `checkout.session.expired` ever arriving.
    await openCheckout("premium", -1);
    expect(await free()).toMatchObject({ held: 0, free: 3 });
  });

  it("stops counting a hold once the session is marked expired", async () => {
    const row = await openCheckout("premium", 30, "cs_expire_me");
    expect((await free()).held).toBe(1);
    expect(await checkouts.markExpired("cs_expire_me")).toBe(true);
    expect((await free()).held).toBe(0);
    expect(row.status).toBe("open");
  });

  it("keeps counting a completed hold until its grant exists", async () => {
    // Handing the seat back the instant the row is claimed would leave it
    // counted by nothing at all for the length of the grant transaction — see
    // "the seat stays counted while the grant is being written" below.
    await openCheckout("premium", 30, "cs_complete_me");
    expect((await free()).held).toBe(1);
    await checkouts.claimForCompletion("cs_complete_me");
    expect((await free()).held).toBe(1);
  });

  it("ignores a revoked grant, as the pool always has", async () => {
    await addGrant("premium", true);
    expect(await free()).toMatchObject({ used: 0, free: 3 });
  });

  it("keeps the coach pool separate from the consumer pool", async () => {
    await openCheckout("start_up_coach_plus", 30);
    expect(await free()).toMatchObject({ held: 0, free: 3 });
    const coach = await grants.freeSeatsWithHolds("coach", (tx) =>
      checkouts.countHeldInPool(tx, "coach", new Date()),
    );
    expect(coach).toMatchObject({ held: 1, cap: 2, free: 1 });
  });

  it("never reports negative seats when holds and grants exceed the cap", async () => {
    // The hold is taken while there is room; the grants land afterwards (an
    // administrator granting by hand does not consult the web holds). The two
    // counts can therefore exceed the cap, and the free figure has to clamp
    // rather than go negative.
    await openCheckout("premium", 30);
    await addGrant("premium");
    await addGrant("premium");
    await addGrant("premium");
    expect(await free()).toMatchObject({ used: 3, held: 1, free: 0 });
  });

  describe("the reservation is atomic with the capacity check", () => {
    it("refuses the reservation rather than overselling the last place", async () => {
      await addGrant("premium");
      await addGrant("premium");
      await addGrant("premium");
      const outcome = await grants.reserveSeatUnderPoolLock(
        "consumer",
        async (tx) => ({
          held: await checkouts.countHeldInPool(tx, "consumer", new Date()),
          reserve: () =>
            checkouts.reserveIn(tx, {
              email: "late@example.test",
              tierName: "premium",
              months: 6,
              referralCode: null,
              campaignSlug: null,
              holdExpiresAt: new Date(Date.now() + 60_000),
              eventId: null,
              fbc: null,
              fbp: null,
              marketingConsent: false,
            }),
        }),
      );
      expect(outcome).toBe("pool_full");
      // Nothing was written — the refusal must not leave a phantom hold.
      const rows = await pg.query(`SELECT 1 FROM founding_checkout_sessions`);
      expect(rows.rows).toEqual([]);
    });

    it("counts an existing hold when deciding whether the last place is free", async () => {
      await addGrant("premium");
      await addGrant("premium");
      await openCheckout("premium", 30);
      const outcome = await grants.reserveSeatUnderPoolLock(
        "consumer",
        async (tx) => ({
          held: await checkouts.countHeldInPool(tx, "consumer", new Date()),
          reserve: () =>
            checkouts.reserveIn(tx, {
              email: "second@example.test",
              tierName: "premium",
              months: 6,
              referralCode: null,
              campaignSlug: null,
              holdExpiresAt: new Date(Date.now() + 60_000),
              eventId: null,
              fbc: null,
              fbp: null,
              marketingConsent: false,
            }),
        }),
      );
      expect(outcome).toBe("pool_full");
    });

    it("passes the caller's own refusal straight back, writing nothing", async () => {
      const outcome = await grants.reserveSeatUnderPoolLock(
        "consumer",
        async () => "too_many_holds" as const,
      );
      expect(outcome).toBe("too_many_holds");
      const rows = await pg.query(`SELECT 1 FROM founding_checkout_sessions`);
      expect(rows.rows).toEqual([]);
    });

    it("holds a seat before any Stripe session exists", async () => {
      // The reservation carries a placeholder id that no webhook can match.
      const row = await grants.reserveSeatUnderPoolLock(
        "consumer",
        async (tx) => ({
          held: 0,
          reserve: () =>
            checkouts.reserveIn(tx, {
              email: "early@example.test",
              tierName: "premium",
              months: 6,
              referralCode: null,
              campaignSlug: null,
              holdExpiresAt: new Date(Date.now() + 60_000),
              eventId: null,
              fbc: null,
              fbp: null,
              marketingConsent: false,
            }),
        }),
      );
      if (typeof row === "string") throw new Error(row);
      expect(row.stripeSessionId.startsWith("reserved_")).toBe(true);
      expect(row.amountMinor).toBe(0);
      expect((await free()).held).toBe(1);
      expect(
        await checkouts.claimForCompletion(row.stripeSessionId),
      ).not.toBeNull();
    });

    it("releases a reservation whose Stripe call never landed", async () => {
      const row = await grants.reserveSeatUnderPoolLock(
        "consumer",
        async (tx) => ({
          held: 0,
          reserve: () =>
            checkouts.reserveIn(tx, {
              email: "failed@example.test",
              tierName: "premium",
              months: 6,
              referralCode: null,
              campaignSlug: null,
              holdExpiresAt: new Date(Date.now() + 60_000),
              eventId: null,
              fbc: null,
              fbp: null,
              marketingConsent: false,
            }),
        }),
      );
      if (typeof row === "string") throw new Error(row);
      expect((await free()).held).toBe(1);
      await checkouts.releaseReservation(row.id);
      expect((await free()).held).toBe(0);
    });
  });

  describe("one open hold per address", () => {
    it("counts only this address's unexpired open holds", async () => {
      await openCheckout("premium", 30, "cs_mine", "buyer@example.test");
      await openCheckout("premium", 30, "cs_theirs", "other@example.test");
      await openCheckout("premium", -1, "cs_lapsed", "buyer@example.test");
      const db = drizzle(pg, { schema });
      expect(
        await checkouts.countOpenHoldsForEmail(
          db as never,
          "buyer@example.test",
          new Date(),
        ),
      ).toBe(1);
    });

    it("stops counting once that hold completes", async () => {
      await openCheckout("premium", 30, "cs_done", "buyer@example.test");
      await checkouts.claimForCompletion("cs_done");
      const db = drizzle(pg, { schema });
      expect(
        await checkouts.countOpenHoldsForEmail(
          db as never,
          "buyer@example.test",
          new Date(),
        ),
      ).toBe(0);
    });
  });

  describe("the seat stays counted while the grant is being written", () => {
    it("counts a completed row that has no grant attached yet", async () => {
      // Between the claim and the grant transaction the row matches neither
      // the hold count (no longer `open`) nor the grant count (no row yet). A
      // checkout arriving in that gap would see a free seat already sold.
      await openCheckout("premium", 30, "cs_settling");
      await checkouts.claimForCompletion("cs_settling");
      expect((await free()).held).toBe(1);
    });

    it("stops counting once the grant is attached", async () => {
      await openCheckout("premium", 30, "cs_settled");
      const claimed = await checkouts.claimForCompletion("cs_settled");
      const grant = await pg.query<{ id: string }>(
        `INSERT INTO founding_grants (email, tier_name, months, granted_by)
         VALUES ('x@example.test', 'premium', 6, $1) RETURNING id`,
        [ADMIN],
      );
      await checkouts.attachGrant(claimed!.id, grant.rows[0]!.id);
      // Counted by the GRANT now, not by the hold — double-counting would lose
      // a place from the pool.
      expect((await free()).held).toBe(0);
      expect((await free()).used).toBe(1);
    });

    it("releases the seat when a completed row is never granted", async () => {
      // A `needs_review` row waits on a human. It must not pin a place for
      // good, so the settling window expires.
      await openCheckout("premium", 30, "cs_stuck");
      await checkouts.claimForCompletion("cs_stuck");
      await pg.query(
        `UPDATE founding_checkout_sessions SET updated_at = now() - interval '11 minutes'`,
      );
      expect((await free()).held).toBe(0);
    });
  });

  describe("resuming an abandoned checkout", () => {
    it("finds the open session an address already has", async () => {
      await openCheckout("premium", 30, "cs_open", "buyer@example.test");
      const found = await checkouts.findOpenHoldForEmail(
        "buyer@example.test",
        new Date(),
      );
      expect(found).toMatchObject({ stripeSessionId: "cs_open" });
    });

    it("finds a reservation whose Stripe call never completed", async () => {
      // Excluding these would leave the address locked out by the per-address
      // hold cap for half an hour, over a seat holding nothing, with no way
      // for the route to clear it.
      const row = await grants.reserveSeatUnderPoolLock(
        "consumer",
        async (tx) => ({
          held: 0,
          reserve: () =>
            checkouts.reserveIn(tx, {
              email: "bare@example.test",
              tierName: "premium",
              months: 6,
              referralCode: null,
              campaignSlug: null,
              holdExpiresAt: new Date(Date.now() + 60_000),
              eventId: null,
              fbc: null,
              fbp: null,
              marketingConsent: false,
            }),
        }),
      );
      expect(typeof row).not.toBe("string");
      const found = await checkouts.findOpenHoldForEmail(
        "bare@example.test",
        new Date(),
      );
      expect(found?.stripeSessionId.startsWith("reserved_")).toBe(true);
    });

    it("ignores a lapsed or finished session", async () => {
      await openCheckout("premium", -1, "cs_lapsed", "a@example.test");
      expect(
        await checkouts.findOpenHoldForEmail("a@example.test", new Date()),
      ).toBeNull();
      await openCheckout("premium", 30, "cs_done", "b@example.test");
      await checkouts.claimForCompletion("cs_done");
      expect(
        await checkouts.findOpenHoldForEmail("b@example.test", new Date()),
      ).toBeNull();
    });
  });

  it("forgets an attribution the grant could not honour", async () => {
    // Leaving the code would have the admin attribution and the analytics both
    // credit a partner with a sale their code did not earn.
    const row = await openCheckout("premium", 30, "cs_ref");
    await pg.query(
      `UPDATE founding_checkout_sessions SET referral_code = 'METAFOUND' WHERE id = $1`,
      [row.id],
    );
    await checkouts.clearReferral(row.id);
    expect(
      (await checkouts.findByStripeSessionId("cs_ref"))?.referralCode,
    ).toBeNull();
  });

  describe("claiming a completion", () => {
    it("returns the row exactly once, however many times it is called", async () => {
      // The idempotency guard. Two webhook deliveries in flight together must
      // not both go on to create a grant for one payment.
      await openCheckout("premium", 30, "cs_race");
      const first = await checkouts.claimForCompletion("cs_race");
      const second = await checkouts.claimForCompletion("cs_race");
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it("returns null for a session that was never ours", async () => {
      expect(await checkouts.claimForCompletion("cs_unknown")).toBeNull();
    });

    it("will not walk a completed session back to expired", async () => {
      // The two Stripe events can cross; a paid session must never end up in a
      // state implying nobody paid.
      await openCheckout("premium", 30, "cs_crossed");
      await checkouts.claimForCompletion("cs_crossed");
      expect(await checkouts.markExpired("cs_crossed")).toBe(false);
      const row = await checkouts.findByStripeSessionId("cs_crossed");
      expect(row?.status).toBe("completed");
    });
  });

  it("refuses a second row for one Stripe session id", async () => {
    // UNIQUE on `stripe_session_id` is what makes a redelivered completion land
    // on the same row rather than a new one.
    await openCheckout("premium", 30, "cs_dupe");
    await expect(openCheckout("premium", 30, "cs_dupe")).rejects.toThrow();
  });

  it.each([
    ["an unsupported term", { months: 3 }],
    ["a mixed-case email", { email: "Buyer@Example.test" }],
    ["a lower-case referral code", { referralCode: "metafound" }],
    ["a malformed campaign slug", { campaignSlug: "Meta Ads" }],
  ])("rejects %s at the database", async (_label, override) => {
    await expect(
      grants.reserveSeatUnderPoolLock("consumer", async (tx) => ({
        held: 0,
        reserve: () =>
          checkouts.reserveIn(tx, {
            email: "buyer@example.test",
            tierName: "premium",
            months: 6,
            referralCode: null,
            campaignSlug: null,
            holdExpiresAt: new Date(Date.now() + 60_000),
            eventId: null,
            fbc: null,
            fbp: null,
            marketingConsent: false,
            ...override,
          }),
      })),
    ).rejects.toThrow();
  });

  it("keeps the checkout record when its grant is deleted", async () => {
    // ON DELETE SET NULL: the record that money changed hands must outlive the
    // grant it produced.
    await openCheckout("premium", 30, "cs_keepme");
    const claimed = await checkouts.claimForCompletion("cs_keepme");
    const grant = await pg.query<{ id: string }>(
      `INSERT INTO founding_grants (email, tier_name, months, granted_by)
       VALUES ('buyer@example.test', 'premium', 6, $1) RETURNING id`,
      [ADMIN],
    );
    await checkouts.attachGrant(claimed!.id, grant.rows[0]!.id);
    await pg.query(`DELETE FROM founding_grants WHERE id = $1`, [
      grant.rows[0]!.id,
    ]);
    const row = await checkouts.findByStripeSessionId("cs_keepme");
    expect(row).toMatchObject({ status: "completed", grantId: null });
  });

  describe("the refund path's lookups", () => {
    async function paidGrantAndCheckout() {
      await openCheckout("premium", 30, "cs_paid");
      const claimed = await checkouts.claimForCompletion("cs_paid");
      const grant = await pg.query<{ id: string }>(
        `INSERT INTO founding_grants
           (email, tier_name, months, amount_minor, payment_method,
            payment_reference, paid_at, granted_by)
         VALUES ('buyer@example.test', 'premium', 6, 3000, 'stripe_checkout',
                 'pi_1', now(), $1) RETURNING id`,
        [ADMIN],
      );
      await checkouts.attachGrant(claimed!.id, grant.rows[0]!.id);
      return { checkoutId: claimed!.id, grantId: grant.rows[0]!.id };
    }

    it("finds the live grant a Stripe payment paid for", async () => {
      const { grantId } = await paidGrantAndCheckout();
      expect(await grants.findLiveByPaymentReference("pi_1")).toMatchObject({
        id: grantId,
      });
    });

    it("ignores a grant whose reference merely collides", async () => {
      // `payment_reference` also holds hand-typed bank references. A refund
      // must never revoke a grant because somebody's bank reference happened
      // to match a Stripe id.
      await pg.query(
        `INSERT INTO founding_grants
           (email, tier_name, months, amount_minor, payment_method,
            payment_reference, paid_at, granted_by)
         VALUES ('bank@example.test', 'premium', 6, 3000, 'bank_transfer',
                 'pi_1', now(), $1)`,
        [ADMIN],
      );
      expect(await grants.findLiveByPaymentReference("pi_1")).toBeNull();
    });

    it("ignores an already-revoked grant", async () => {
      const { grantId } = await paidGrantAndCheckout();
      await pg.query(
        `UPDATE founding_grants SET revoked_at = now(), revoke_reason = 'x' WHERE id = $1`,
        [grantId],
      );
      expect(await grants.findLiveByPaymentReference("pi_1")).toBeNull();
    });

    it("finds the checkout a grant came from, and marks it refunded", async () => {
      const { checkoutId, grantId } = await paidGrantAndCheckout();
      const found = await checkouts.findCompletedByGrantId(grantId);
      expect(found).toMatchObject({ id: checkoutId });
      await checkouts.markRefunded(checkoutId);
      expect((await checkouts.findByStripeSessionId("cs_paid"))?.status).toBe(
        "refunded",
      );
    });

    it("finds no checkout for a grant that did not come from one", async () => {
      const grant = await pg.query<{ id: string }>(
        `INSERT INTO founding_grants (email, tier_name, months, granted_by)
         VALUES ('handgranted@example.test', 'premium', 6, $1) RETURNING id`,
        [ADMIN],
      );
      expect(
        await checkouts.findCompletedByGrantId(grant.rows[0]!.id),
      ).toBeNull();
    });
  });

  it("accepts stripe_checkout as a contribution method", async () => {
    // The migration widens the CHECK; without it every web purchase would fail
    // at the last step, after the customer had paid.
    await expect(
      pg.query(
        `INSERT INTO founding_grants
           (email, tier_name, months, amount_minor, payment_method, paid_at, granted_by)
         VALUES ('paid@example.test', 'premium', 6, 3000, 'stripe_checkout', now(), $1)`,
        [ADMIN],
      ),
    ).resolves.toBeDefined();
  });
});
