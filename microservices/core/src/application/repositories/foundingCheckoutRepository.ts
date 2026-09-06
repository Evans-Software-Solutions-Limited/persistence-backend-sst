import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  foundingCheckoutSessions,
  type FoundingCheckoutSession,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  RESERVATION_PREFIX,
  tiersInPool,
  type FoundingPool,
} from "../founding/foundingOffer";
import type { DatabaseTransaction } from "./referralRepository";

/**
 * Founding purchases in flight (FOUNDING-OFFER BRIEF § 2, 2026-09-05
 * amendment).
 *
 * The reason this table exists is the SEAT HOLD. Pool capacity is counted from
 * non-revoked `founding` grants, and a grant is only created once Stripe
 * confirms payment. Between "buyer clicks Buy" and "webhook arrives" there is a
 * window — up to the Session's 30-minute expiry — in which the seat looks free.
 * Without a hold the last place in the pool is sold to everyone who happens to
 * be on Stripe's page at the same moment, and the losers are refunded by hand.
 *
 * A hold is deliberately SOFT: it is an open row whose `hold_expires_at` is
 * still in the future. An abandoned checkout therefore frees its seat on its
 * own, with no sweeper to run and nothing to go wrong if
 * `checkout.session.expired` is never delivered.
 */

type Tx = DatabaseTransaction;
/** Either a pooled connection or an open transaction — reads work on both. */
type Reader = Tx | ReturnType<typeof getDb>;

export type CheckoutStatus = "open" | "completed" | "expired" | "refunded";

/**
 * How long a completed-but-ungranted row keeps holding its seat. Covers the
 * grant transaction with room to spare, and expires so a row awaiting a manual
 * decision does not take a place out of the pool for good.
 */
const SETTLING_WINDOW_MS = 10 * 60 * 1000;

export interface ReserveCheckoutInput {
  email: string;
  tierName: string;
  months: number;
  referralCode: string | null;
  campaignSlug: string | null;
  holdExpiresAt: Date;
  eventId: string | null;
  fbc: string | null;
  fbp: string | null;
  marketingConsent: boolean;
}

export class FoundingCheckoutRepository {
  /**
   * How many pool places are currently held by checkouts in flight.
   *
   * Counts open rows for the pool's tiers whose hold has not lapsed. Must be
   * called inside the same transaction and advisory lock as the grant count it
   * is added to, or the two reads can straddle a concurrent purchase.
   */
  async countHeldInPool(
    db: Reader,
    pool: FoundingPool,
    now: Date,
  ): Promise<number> {
    // A row counts while EITHER is true:
    //
    //  - it is `open` and its hold has not lapsed — the buyer is on Stripe's
    //    page;
    //  - it has just completed but has no grant attached yet — the webhook has
    //    claimed it and is mid-grant. Without this second case the seat is
    //    counted by neither this nor `countLiveInPool` for the length of the
    //    grant transaction, and a checkout arriving in that gap sees a free
    //    seat that is already sold.
    //
    // The second case is time-bounded so a `needs_review` row — completed,
    // never granted, waiting on Brad — cannot pin a place indefinitely.
    const settling = new Date(now.getTime() - SETTLING_WINDOW_MS);
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(foundingCheckoutSessions)
      .where(
        and(
          inArray(foundingCheckoutSessions.tierName, tiersInPool(pool)),
          or(
            and(
              eq(foundingCheckoutSessions.status, "open"),
              gt(foundingCheckoutSessions.holdExpiresAt, now),
            ),
            and(
              eq(foundingCheckoutSessions.status, "completed"),
              isNull(foundingCheckoutSessions.grantId),
              gt(foundingCheckoutSessions.updatedAt, settling),
            ),
          ),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * How many holds this address already has in flight.
   *
   * A hold costs nothing to create and takes a place out of a capped pool for
   * half an hour, so without a per-address cap one person — or one script —
   * can empty the pool without paying anything. Counted inside the caller's
   * locked transaction, like the pool count it accompanies.
   */
  async countOpenHoldsForEmail(
    db: Reader,
    email: string,
    now: Date,
  ): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(foundingCheckoutSessions)
      .where(
        and(
          eq(foundingCheckoutSessions.email, email),
          eq(foundingCheckoutSessions.status, "open"),
          gt(foundingCheckoutSessions.holdExpiresAt, now),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Take the seat, INSIDE the caller's already-locked transaction.
   *
   * This is the whole point of the lock and it is why the insert cannot wait
   * until after Stripe answers. Checking capacity, releasing the lock, making
   * a network round trip and only then recording the hold is check-then-act:
   * two buyers a few hundred milliseconds apart both read the last seat as
   * free, both get a Session, both pay, and one is refunded by hand.
   *
   * The row is created before the Stripe Session exists, so it carries a
   * placeholder `stripe_session_id` — unique, and impossible to confuse with a
   * real one — which {@link attachStripeSession} replaces once Stripe answers.
   * A placeholder row left behind by a failed Stripe call is released by
   * {@link releaseReservation}, and would in any case stop counting when its
   * hold lapsed.
   */
  async reserveIn(
    tx: Tx,
    input: ReserveCheckoutInput,
  ): Promise<FoundingCheckoutSession> {
    const [row] = await tx
      .insert(foundingCheckoutSessions)
      .values({
        stripeSessionId: `${RESERVATION_PREFIX}${randomUUID()}`,
        email: input.email,
        tierName: input.tierName,
        months: input.months,
        // Not yet known — Stripe's Price decides it, and the Session that
        // reports it has not been created. Filled in by `attachStripeSession`.
        amountMinor: 0,
        currency: "GBP",
        referralCode: input.referralCode,
        campaignSlug: input.campaignSlug,
        holdExpiresAt: input.holdExpiresAt,
        eventId: input.eventId,
        fbc: input.fbc,
        fbp: input.fbp,
        marketingConsent: input.marketingConsent,
      })
      .returning();
    return row!;
  }

  /**
   * Bind a reservation to the Stripe Session it produced.
   *
   * `holdExpiresAt` is re-set from the SESSION's own expiry rather than left at
   * the stamp chosen before the pool transaction ran. Stripe's `expires_at` is
   * necessarily a little later — it is computed at send time with headroom, or
   * the call is rejected for being under Stripe's 30-minute floor — and a
   * session that outlives its hold is payable after the seat has been given to
   * somebody else, which is the oversell the hold exists to prevent.
   */
  async attachStripeSession(
    id: string,
    stripeSessionId: string,
    amountMinor: number,
    currency: string,
    holdExpiresAt: Date,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(foundingCheckoutSessions)
      .set({
        stripeSessionId,
        amountMinor,
        currency,
        holdExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(foundingCheckoutSessions.id, id));
  }

  /**
   * The open, unexpired checkout this address already has, if any.
   *
   * Includes rows still carrying a `reserved_` placeholder — a reservation
   * whose Stripe call never completed. Excluding them would leave the address
   * locked out by `countOpenHoldsForEmail` for half an hour over a seat
   * holding nothing, with no way for the caller to clear it.
   */
  async findOpenHoldForEmail(
    email: string,
    now: Date,
  ): Promise<FoundingCheckoutSession | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(foundingCheckoutSessions)
      .where(
        and(
          eq(foundingCheckoutSessions.email, email),
          eq(foundingCheckoutSessions.status, "open"),
          gt(foundingCheckoutSessions.holdExpiresAt, now),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Give a reserved seat straight back when the checkout never got off the
   * ground. Best-effort — the hold would expire on its own — but returning it
   * immediately matters when the pool is nearly full.
   */
  async releaseReservation(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(foundingCheckoutSessions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(foundingCheckoutSessions.id, id),
          eq(foundingCheckoutSessions.status, "open"),
        ),
      );
  }

  async findByStripeSessionId(
    stripeSessionId: string,
  ): Promise<FoundingCheckoutSession | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(foundingCheckoutSessions)
      .where(eq(foundingCheckoutSessions.stripeSessionId, stripeSessionId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Claim an open session for completion, atomically.
   *
   * The `status = 'open'` predicate is the idempotency guard, not a
   * convenience: webhook delivery is at-least-once and two deliveries can be
   * in flight together, so "read the row, see it is open, then write" would let
   * both callers create a grant. Only the caller whose UPDATE returns a row may
   * go on to grant.
   */
  async claimForCompletion(
    stripeSessionId: string,
  ): Promise<FoundingCheckoutSession | null> {
    const db = getDb();
    const [row] = await db
      .update(foundingCheckoutSessions)
      .set({ status: "completed", updatedAt: new Date() })
      .where(
        and(
          eq(foundingCheckoutSessions.stripeSessionId, stripeSessionId),
          eq(foundingCheckoutSessions.status, "open"),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Forget an attribution the grant could not honour, so the admin tables do
   * not credit a partner with a sale their code did not earn.
   */
  async clearReferral(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(foundingCheckoutSessions)
      .set({ referralCode: null, updatedAt: new Date() })
      .where(eq(foundingCheckoutSessions.id, id));
  }

  async attachGrant(id: string, grantId: string): Promise<void> {
    const db = getDb();
    await db
      .update(foundingCheckoutSessions)
      .set({ grantId, updatedAt: new Date() })
      .where(eq(foundingCheckoutSessions.id, id));
  }

  /**
   * Mark an unfinished session expired, releasing its hold early.
   *
   * Only touches `open` rows: a `completed` session that Stripe also reports as
   * expired (possible when the two events cross) must not be walked backwards
   * into a state that implies nobody paid.
   */
  async markExpired(stripeSessionId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .update(foundingCheckoutSessions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(foundingCheckoutSessions.stripeSessionId, stripeSessionId),
          eq(foundingCheckoutSessions.status, "open"),
        ),
      )
      .returning({ id: foundingCheckoutSessions.id });
    return rows.length > 0;
  }

  async markRefunded(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(foundingCheckoutSessions)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(eq(foundingCheckoutSessions.id, id));
  }

  /**
   * The completed session a Stripe payment intent belongs to, for the refund
   * path. The payment-intent id is stored on the GRANT as its contribution
   * reference, so the lookup goes through there rather than duplicating it.
   */
  async findCompletedByGrantId(
    grantId: string,
  ): Promise<FoundingCheckoutSession | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(foundingCheckoutSessions)
      .where(eq(foundingCheckoutSessions.grantId, grantId))
      .limit(1);
    return rows[0] ?? null;
  }
}
