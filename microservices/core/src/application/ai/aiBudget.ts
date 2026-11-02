import { and, count, desc, eq, gte } from "drizzle-orm";
import {
  aiUsageLog,
  subscriptionTiers,
  userSubscriptions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { costPerUsageEndpoint } from "@persistence/subscription-catalog";
import {
  classifySubscriptionStatus,
  parsePriceDecimal,
  resolveEffectiveScheduledTier,
} from "../entitlement/assertEntitlement";

/**
 * Per-user AI spend budget (spec-29 Phase 1, STORY-002).
 *
 * Every AI endpoint already has a per-feature daily ceiling, but those caps
 * don't bound a user's TOTAL spend: a user can max every feature at once. This
 * check prices the user's calls over a rolling 30 days from the shared cost
 * table and refuses the next call when it would take them past their tier's
 * `subscription_tiers.ai_monthly_budget_usd`.
 *
 * It is a backend fail-safe, never an advertised quota (AC 2.4): the wire
 * signal is a 429 `ai_budget_exhausted`, with no balance or count exposed.
 *
 * Order in a handler: entitlement → per-feature ceiling → THIS → inference.
 * The per-feature ceilings are kept (AC 2.2); this is the margin backstop.
 *
 * Fail-closed rules:
 *   - no budget configured (NULL) → 0, so the call is refused;
 *   - a lapsed / cancelled subscription → the free tier's budget;
 *   - an endpoint missing from the cost table → priced at the most
 *     expensive call (`costPerUsageEndpoint`);
 *   - database errors propagate; the handler's own error path decides.
 *
 * Like the per-feature ceilings, this is best-effort under concurrency: two
 * simultaneous requests can both pass on the last few cents of budget. That
 * is acceptable for a cost backstop.
 */

export const AI_BUDGET_WINDOW_DAYS = 30;

/** The 429 body a handler returns when the budget refuses a call. */
export const AI_BUDGET_EXHAUSTED_BODY = {
  error: "ai_budget_exhausted",
} as const;

// Floating-point slack so a call that lands exactly on the budget passes.
const EPSILON_USD = 1e-9;

/**
 * Pure decision: may a call costing `nextCallUsd` run, given what the user has
 * spent in the window and their budget? A cheap call can still pass when an
 * expensive one would not (AC 2.1).
 */
export function budgetAllows(input: {
  budgetUsd: number;
  spentUsd: number;
  nextCallUsd: number;
}): boolean {
  return input.spentUsd + input.nextCallUsd <= input.budgetUsd + EPSILON_USD;
}

/** Sum the priced cost of a set of per-endpoint call counts. */
export function priceUsage(
  rows: ReadonlyArray<{ endpoint: string; calls: number | string }>,
): number {
  let total = 0;
  for (const row of rows) {
    total += Number(row.calls) * costPerUsageEndpoint(row.endpoint);
  }
  return total;
}

function toBudget(raw: string | number | null | undefined): number {
  const value = parsePriceDecimal(raw);
  return value !== null && value > 0 ? value : 0;
}

/**
 * The user's budget in USD per rolling 30 days, resolved the same way
 * `assertEntitlement`'s `ai_access` check resolves the tier: latest
 * subscription row joined to its tier; no row, or a lapsed one, falls back to
 * the free tier.
 */
export async function loadAiMonthlyBudgetUsd(userId: string): Promise<number> {
  const db = getDb();
  const subRows = await db
    .select({
      paymentStatus: userSubscriptions.paymentStatus,
      expiresAt: userSubscriptions.expiresAt,
      cancelledAt: userSubscriptions.cancelledAt,
      metadata: userSubscriptions.metadata,
      budget: subscriptionTiers.aiMonthlyBudgetUsd,
    })
    .from(userSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(userSubscriptions.tierName, subscriptionTiers.tierName),
    )
    .where(eq(userSubscriptions.userId, userId))
    .orderBy(desc(userSubscriptions.createdAt))
    .limit(1);

  const sub = subRows[0];
  if (sub) {
    const lapsed = classifySubscriptionStatus(
      sub.paymentStatus,
      sub.expiresAt,
      sub.cancelledAt,
      resolveEffectiveScheduledTier(sub.metadata) !== null,
    );
    if (lapsed === null) return toBudget(sub.budget);
  }

  const freeRows = await db
    .select({ budget: subscriptionTiers.aiMonthlyBudgetUsd })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, "free"))
    .limit(1);
  return toBudget(freeRows[0]?.budget);
}

/** USD the user's AI calls have cost over the rolling window ending `now`. */
export async function spentInWindowUsd(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(
    now.getTime() - AI_BUDGET_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const rows = await getDb()
    .select({ endpoint: aiUsageLog.endpoint, calls: count() })
    .from(aiUsageLog)
    .where(and(eq(aiUsageLog.userId, userId), gte(aiUsageLog.createdAt, since)))
    .groupBy(aiUsageLog.endpoint);
  return priceUsage(rows);
}

/**
 * True when the user may make one more call to the endpoint that writes
 * `usageEndpoint` to `ai_usage_log`.
 */
export async function hasAiBudget(
  userId: string,
  usageEndpoint: string,
  now: Date = new Date(),
): Promise<boolean> {
  const budgetUsd = await loadAiMonthlyBudgetUsd(userId);
  if (budgetUsd <= 0) {
    console.warn(
      `[ai-budget] refused user=${userId} endpoint=${usageEndpoint} reason=no_budget`,
    );
    return false;
  }
  const spentUsd = await spentInWindowUsd(userId, now);
  const nextCallUsd = costPerUsageEndpoint(usageEndpoint);
  const allowed = budgetAllows({ budgetUsd, spentUsd, nextCallUsd });
  if (!allowed) {
    console.warn(
      `[ai-budget] refused user=${userId} endpoint=${usageEndpoint} reason=exhausted spent=${spentUsd.toFixed(4)} budget=${budgetUsd.toFixed(2)}`,
    );
  }
  return allowed;
}
