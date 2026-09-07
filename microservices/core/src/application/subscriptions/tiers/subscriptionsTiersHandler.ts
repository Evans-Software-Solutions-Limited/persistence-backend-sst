import Elysia from "elysia";
import { publicPreflight, withPublicCors } from "../../../shared/publicCors";

import {
  SubscriptionTiersRepository,
  type SubscriptionTierRow,
} from "../../repositories/subscriptionTiersRepository";
import { FoundingGrantRepository } from "../../repositories/foundingGrantRepository";
import { FoundingCheckoutRepository } from "../../repositories/foundingCheckoutRepository";
import { getDb } from "@persistence/db/client";

/**
 * GET /subscription-tiers — public read of the active tier catalog.
 *
 * **No auth.** The auth-flow subscription-selection screen renders
 * BEFORE sign-in (it's part of the post-sign-up onboarding) so this
 * endpoint must be reachable without a JWT. Tier metadata is non-
 * sensitive — prices, feature flags, Stripe price IDs (which are
 * already exposed to the client SDK during checkout).
 *
 * Wire shape mirrors the `SubscriptionTier` domain model in
 * specs/11-payments-subscriptions/design.md § Domain models. Drizzle's
 * `decimal` type round-trips as a string ("9.99") on the way out of
 * Postgres; we parse to `number` here so the mobile presenter doesn't
 * have to coerce repeatedly across the catalog list. `null` decimals
 * stay null (e.g. yearly price absent on a tier with no annual option).
 *
 * Empty catalog → `{ data: [] }` + 200. Caller treats this as a deploy
 * misconfiguration (`subscription_tiers` not seeded for this stage),
 * not a runtime error.
 */

/**
 * Wire-shape `SubscriptionTier`. Mirrors the domain model exported by
 * the mobile package — kept aligned with that contract is the
 * load-bearing M10 cross-cutting concern.
 */
export interface SubscriptionTierWire {
  tierName: string;
  displayName: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number | null;
  currency: string;
  features: Record<string, unknown>;
  workoutLimit: number | null;
  aiAccess: boolean;
  aiWorkoutLimit: number;
  gymBuddyAccess: boolean;
  trainerClientLimit: number | null;
  isTrainerTier: boolean;
  analyticsAccess: boolean;
  exportAccess: boolean;
  stripePriceIdMonthly: string | null;
  stripePriceIdYearly: string | null;
}

/**
 * Convert a Drizzle `decimal` value (returned as string) to `number`.
 * Mirrors the pattern in `dashboardRepository.coerceNumeric` /
 * `profileRepository.coerceDecimal` — duplicated locally rather than
 * imported because the call site has different null-handling semantics
 * (price_monthly is NOT NULL, price_yearly is nullable).
 */
function decimalToNumber(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Strict variant for NOT NULL decimal columns — defaults to 0 if the
 * value somehow turns up null/NaN at runtime. `price_monthly` carries
 * a NOT NULL constraint at the DB layer, so the fallback is a
 * belt-and-braces guard against an out-of-band manual edit producing
 * an unparseable value rather than a real runtime path.
 */
function requiredDecimal(value: string | number | null): number {
  return decimalToNumber(value) ?? 0;
}

/**
 * Map a Drizzle row to the wire-shape `SubscriptionTier`. Pure function
 * — exported for direct unit tests without spinning up the Elysia
 * harness.
 */
export function mapTierRowToWire(
  row: SubscriptionTierRow,
): SubscriptionTierWire {
  return {
    tierName: row.tierName,
    displayName: row.displayName,
    description: row.description ?? null,
    priceMonthly: requiredDecimal(row.priceMonthly),
    priceYearly: decimalToNumber(row.priceYearly),
    currency: row.currency ?? "GBP",
    features: (row.features ?? {}) as Record<string, unknown>,
    workoutLimit: row.workoutLimit ?? null,
    aiAccess: row.aiAccess === true,
    aiWorkoutLimit: row.aiWorkoutLimit ?? 0,
    gymBuddyAccess: row.gymBuddyAccess === true,
    trainerClientLimit: row.trainerClientLimit ?? null,
    isTrainerTier: row.isTrainerTier === true,
    analyticsAccess: row.analyticsAccess === true,
    exportAccess: row.exportAccess === true,
    stripePriceIdMonthly: row.stripePriceIdMonthly ?? null,
    stripePriceIdYearly: row.stripePriceIdYearly ?? null,
  };
}

export const subscriptionsTiersHandler = new Elysia()
  // Both routes below are read by the WEBSITE from a different origin, and the
  // gateway no longer supplies CORS (`infra/api.ts` sets `cors: false`). A GET
  // with no custom headers is never preflighted, but the browser still hides
  // the response body from the page without an allow-origin header — so these
  // are needed for the pricing table and the founding counter to render at
  // all, even though neither request is "complex".
  .options("/subscription-tiers", () => publicPreflight())
  .options("/founding/availability", () => publicPreflight())
  .get(
    "/subscription-tiers",
    async ({ set }): Promise<{ data: SubscriptionTierWire[] }> => {
      withPublicCors({ set });
      const repo = new SubscriptionTiersRepository();
      const rows = await repo.listActive();
      return { data: rows.map(mapTierRowToWire) };
    },
  )
  .get("/founding/availability", async ({ set }) => {
    withPublicCors({ set });
    const repo = new FoundingGrantRepository();
    const checkouts = new FoundingCheckoutRepository();
    const db = getDb();
    const now = new Date();
    // Sequential, not `Promise.all`: four concurrent multi-row reads on one
    // pooled connection is the shape that hangs (memory
    // `reference_postgresjs_max1_concurrency_deadlock`), and this endpoint is
    // cached for 30s so the extra round trips cost nothing anyone notices.
    const consumer = await repo.seatsForPool("consumer");
    const coach = await repo.seatsForPool("coach");
    // Seats held by web checkouts still in flight count as taken. Without this
    // the page advertises a place that somebody is at that moment paying for.
    const consumerHeld = await checkouts.countHeldInPool(db, "consumer", now);
    const coachHeld = await checkouts.countHeldInPool(db, "coach", now);
    set.headers["cache-control"] = "public, max-age=30";
    return {
      data: {
        consumer: {
          used: Math.min(consumer.cap, consumer.used + consumerHeld),
          cap: consumer.cap,
        },
        coach: {
          used: Math.min(coach.cap, coach.used + coachHeld),
          cap: coach.cap,
        },
      },
    };
  });

// Export pure internals for direct unit tests.
export const __internals = {
  decimalToNumber,
  requiredDecimal,
  mapTierRowToWire,
};
