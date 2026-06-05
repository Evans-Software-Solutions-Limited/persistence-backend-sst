#!/usr/bin/env bun
/**
 * One-shot reconciliation: overwrite `user_subscriptions` rows from
 * Stripe truth.
 *
 * What it does
 * ────────────
 * Paginates `stripe.subscriptions.list({ status: "all", limit: 100 })`
 * across every subscription on the connected Stripe account. For each
 * Stripe subscription it:
 *
 *   1. Reads `metadata.supabase_user_id` to identify the owning user.
 *      Subscriptions missing that key are warned + skipped — they
 *      pre-date the metadata convention or were created out-of-band
 *      against an unmanaged customer.
 *   2. Looks up the local row by `external_subscription_id`.
 *      - If a local row exists, UPDATE in place from Stripe truth.
 *        The local PK is preserved so the DB trigger
 *        `update_subscription_limits_trigger` re-derives `profiles.*`
 *        and `subscription_limits.*` cleanly.
 *      - If no local row exists, INSERT a fresh one. The trigger
 *        runs on insert too.
 *   3. Maps Stripe status → local payment_status using the same
 *      mapping as the inbound webhook (`mapStripeStatusToPaymentStatus`
 *      from the webhook helpers).
 *   4. Preserves `profiles.has_used_user_trial` /
 *      `profiles.has_used_trainer_trial` — append-only flags, never
 *      reset by reconciliation. Users keep their trial-used history
 *      even if their subscription row is overwritten.
 *
 * Modes
 * ─────
 *   --dry-run   Print proposed diffs without writing. Default-on when
 *               run interactively without explicit confirmation; the
 *               `--write` flag commits.
 *   --write     Actually persist the changes. Required to bypass the
 *               implicit dry-run.
 *   --user-id   Limit to a single user (filters Stripe-side via
 *               metadata, plus client-side guard).
 *
 * Runbook
 * ───────
 * When to run:
 *   - After Stripe webhook delivery has been broken for a non-trivial
 *     window (eg. deploy regression, dashboard endpoint mis-configured).
 *   - After mass-importing customers from a legacy provider.
 *   - When manual ops have edited Stripe-side data and you need the
 *     local mirror to catch up.
 *
 * Expected runtime / scale:
 *   - Stripe pages are 100 subs at a time; for accounts under 10k subs
 *     this completes in ~30s of API calls plus DB round-trips.
 *   - Each subscription costs 1 GET on Stripe and 1-2 SQL statements.
 *   - Tested in test mode against ~50 fixture subs before a prod run.
 *
 * Required env (read at startup):
 *   - DATABASE_URL          — Neon Postgres connection string
 *   - STRIPE_SECRET_KEY     — sk_test_… or sk_live_…
 *
 * Usage
 * ─────
 *   bun run scripts/reconcile-stripe.ts --dry-run
 *   bun run scripts/reconcile-stripe.ts --write
 *   bun run scripts/reconcile-stripe.ts --user-id 4f7e... --dry-run
 */

import Stripe from "stripe";
import { eq, or, sql } from "drizzle-orm";
import { subscriptionTiers, userSubscriptions } from "@persistence/db";
import { getDb } from "@persistence/db/client";

// ─── Argument parsing ─────────────────────────────────────────────────

type CliArgs = {
  dryRun: boolean;
  userId: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  let dryRun = true; // default-on
  let write = false;
  let userId: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") {
      write = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--user-id") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.length === 0) {
        throw new Error("--user-id requires a value");
      }
      userId = next;
      i += 1;
    } else if (arg.startsWith("--user-id=")) {
      userId = arg.slice("--user-id=".length);
    }
  }

  // --write takes precedence over the implicit dry-run default.
  if (write) dryRun = false;
  return { dryRun, userId };
}

// ─── Stripe helpers (duplicated from eventHandlers/_helpers.ts) ───────

// Duplicated intentionally — the reconcile script is an ops one-shot
// and importing across the microservices/core boundary into a top-level
// script complicates the bundler / SST classpath. The behaviour MUST
// stay in lockstep with eventHandlers/_helpers.ts; both files document
// the same legacy lines so changes are caught in review.

function mapStripeStatusToPaymentStatus(
  status: Stripe.Subscription.Status,
): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    case "unpaid":
      return "expired";
    default:
      return "pending";
  }
}

/**
 * Grace-period-aware status mapping, mirroring
 * `eventHandlers/_helpers.ts:mapStripeStatusToPaymentStatusForUpdate`.
 *
 * The bare `mapStripeStatusToPaymentStatus` above flips `canceled`
 * straight to `"cancelled"`. But the standard Stripe cancel-at-period-
 * end flow leaves the sub in `status: canceled` with `canceled_at` set
 * AND `current_period_end` still in the future — the user has paid
 * access until that date. Mapping to `"cancelled"` here would let the
 * DB trigger revoke `profiles.role` early and pull access before the
 * period the user paid for actually ends (Inspector Brad PR #70 sweep
 * #4 medium-severity find).
 *
 * Reconcile uses THIS variant — same correctness rationale as the
 * webhook handler. The bare mapping is kept for the rare cases where
 * we genuinely want the unconditional collapse (currently unused after
 * this fix; preserved for symmetry with the inbound helper file).
 */
function mapStripeStatusToPaymentStatusForUpdate(
  subscription: Stripe.Subscription,
): string {
  const status = subscription.status;
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due") return "past_due";

  if (status === "canceled" || status === "incomplete_expired") {
    const periodEnd = readCurrentPeriodEnd(subscription);
    if (subscription.canceled_at && periodEnd !== null) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (periodEnd > nowSeconds) return "active";
      return "cancelled";
    }
    return "cancelled";
  }

  if (status === "unpaid") return "expired";

  return "pending";
}

function unixSecondsToDate(seconds: number | null | undefined): Date | null {
  if (seconds === null || seconds === undefined || seconds === 0) return null;
  return new Date(seconds * 1000);
}

function readCurrentPeriodEnd(
  subscription: Stripe.Subscription,
): number | null {
  const legacy = (
    subscription as unknown as { current_period_end?: number | null }
  ).current_period_end;
  if (typeof legacy === "number" && legacy > 0) return legacy;
  const itemEnd = subscription.items?.data?.[0]?.current_period_end;
  return typeof itemEnd === "number" && itemEnd > 0 ? itemEnd : null;
}

function readUserIdFromMetadata(
  subscription: Stripe.Subscription,
): string | null {
  const userId = subscription.metadata?.supabase_user_id;
  if (typeof userId !== "string" || userId.length === 0) return null;
  return userId;
}

function readTierFromMetadata(subscription: Stripe.Subscription): string {
  // Default to "free" (not the removed "basic" tier — dropped in
  // 20260526120000_simplify_tier_model.sql). spec 17 / Phase D, audit LOW-1.
  return subscription.metadata?.tier_name ?? "free";
}

function readBillingCycleFromMetadata(
  subscription: Stripe.Subscription,
): string {
  return subscription.metadata?.billing_cycle ?? "monthly";
}

function readStripeCustomerId(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
}

// ─── Repo (inlined — no microservices/core import) ────────────────────

async function findByExternalId(externalSubscriptionId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.externalSubscriptionId, externalSubscriptionId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Find any local row whose `metadata.old_stripe_subscription_id` matches
 * the given Stripe sub id. Used by the reconcile loop to detect an
 * **in-flight predecessor** — a Stripe sub that's still alive (non-
 * terminal status) but no longer has a local row pointing at it because
 * `handleSubscriptionChange` swapped the row's external id to a
 * successor sub during a change-of-tier flow.
 *
 * Returns the successor row (which carries the marker), or null when
 * no local row references this id as old.
 *
 * Why this matters: sweep #3 added a terminal-only INSERT skip for
 * canceled / incomplete_expired Stripe subs with no matching local
 * row. But the change-of-tier marker cleanup is **webhook-driven** —
 * if the webhook for the successor sub never fires (delivery outage,
 * 3-attempt retry exhaustion in subscriptionUpdated.ts), the
 * predecessor stays in `active`/`trialing` status forever. Reconcile
 * sees it, falls through the terminal skip, and creates a phantom row.
 *
 * Two failure modes from that phantom:
 *   - successor row is `active`/`pending` → phantom INSERT collides
 *     with `user_subscriptions_active_unique`. counts.failed surfaces
 *     it, but sub keeps billing silently from Stripe's side.
 *   - successor row is `trialing` (not in the active-unique partial
 *     index) → phantom INSERT succeeds. User now has TWO rows;
 *     `findMostRecentForUser`'s createdAt-DESC tie-break is unspecified
 *     (both rows can carry the same `created` from sweep #3's
 *     preserve-createdAt fix), so the next `POST /subscriptions` may
 *     dispatch against the wrong row.
 *
 * Inspector Brad PR #70 sweep #7 medium-severity find.
 */
async function findRowWithOldMarker(stripeSubscriptionId: string) {
  const db = getDb();
  // The metadata column is jsonb; use the `->>` JSON-text accessor to
  // pull the marker value out as a string and compare against the
  // Stripe sub id. Drizzle's `sql` template handles parameterisation
  // safely.
  const rows = await db
    .select()
    .from(userSubscriptions)
    .where(
      sql`${userSubscriptions.metadata}->>'old_stripe_subscription_id' = ${stripeSubscriptionId}`,
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Resolve `tier_name` + `billing_cycle` from a Stripe price id by
 * querying `subscription_tiers`. Mirrors the inverse lookup in
 * `eventHandlers/subscriptionUpdated.ts:resolveTierForPrice` — kept
 * in lockstep so reconcile derives tier the same way the webhook does
 * (never trusts `metadata.tier_name` for the active tier, since
 * mass-imported / ops-portal subs may not carry it).
 *
 * Returns `null` when the price doesn't match a known tier. Caller
 * falls back to metadata (with a warning) so we don't silently
 * downgrade premium/yearly subs to basic/monthly when the price-id
 * lookup misses (Inspector Brad PR #70 sweep #4 high-severity find).
 */
async function resolveTierForPrice(priceId: string): Promise<{
  tierName: string;
  billingCycle: "monthly" | "yearly";
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      tierName: subscriptionTiers.tierName,
      monthly: subscriptionTiers.stripePriceIdMonthly,
      yearly: subscriptionTiers.stripePriceIdYearly,
    })
    .from(subscriptionTiers)
    .where(
      or(
        eq(subscriptionTiers.stripePriceIdMonthly, priceId),
        eq(subscriptionTiers.stripePriceIdYearly, priceId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    tierName: row.tierName,
    billingCycle: row.monthly === priceId ? "monthly" : "yearly",
  };
}

function readStripePriceId(subscription: Stripe.Subscription): string | null {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  return typeof priceId === "string" && priceId.length > 0 ? priceId : null;
}

/**
 * Read the active price's currency from a Stripe subscription. Stripe
 * exposes this at `subscription.items.data[0].price.currency` as a
 * lowercase ISO 4217 string; we uppercase to match the convention used
 * across the `user_subscriptions.currency` column (the schema's default
 * is `"GBP"`, and the outbound flows read `subscription_tiers.currency`
 * which is also uppercase).
 *
 * Returns null when the field is missing — caller omits `currency` from
 * the patch in that case so the column keeps whatever value the existing
 * row already had (Inspector Brad PR #70 sweep #6 low-severity find:
 * previously neither the INSERT payload nor the UPDATE patch set
 * `currency` at all, so a future non-GBP tier would silently stamp every
 * reconciled row to the schema-default "GBP").
 */
function readStripePriceCurrency(
  subscription: Stripe.Subscription,
): string | null {
  const currency = subscription.items?.data?.[0]?.price?.currency;
  if (typeof currency !== "string" || currency.length === 0) return null;
  return currency.toUpperCase();
}

type ReconciliationOp =
  | { op: "skip"; reason: string; stripeId: string }
  | {
      op: "insert";
      stripeId: string;
      userId: string;
      payload: typeof userSubscriptions.$inferInsert;
    }
  | {
      op: "update";
      stripeId: string;
      userId: string;
      localId: string;
      patch: Partial<typeof userSubscriptions.$inferInsert>;
    };

/**
 * Stripe statuses representing permanently-dead subs. We do NOT insert
 * phantom local rows for these — they're historical, the underlying
 * Stripe sub is immutable and irrelevant to the user's current state,
 * and the change-of-tier flow in `subscriptionsCreateHandler.ts`
 * repurposes local rows in place rather than retiring the old one, so
 * canceled subs from prior changes never had a corresponding local
 * row to begin with.
 *
 * Without this skip, reconcile would create a fresh row per historical
 * canceled sub with `createdAt = now()` — and since
 * `findMostRecentForUser` orders by `createdAt DESC`, the phantom would
 * become the user's "most recent" row. On the user's next subscribe,
 * dispatch would route through change-path against the phantom and try
 * to flip its paymentStatus to active, colliding with the still-active
 * row on the `user_subscriptions_active_unique` partial index. The user
 * would be permanently locked out of subscribing until the phantom is
 * hand-cleaned (Inspector Brad PR #70 sweep #3 high-severity find).
 *
 * UPDATE branch is unaffected — when a canceled Stripe sub DOES have a
 * matching local row, that row is the user's current cancelled state
 * and reconcile correctly mirrors Stripe into it.
 */
const TERMINAL_STRIPE_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "incomplete_expired",
]);

function buildOp(
  subscription: Stripe.Subscription,
  existing: typeof userSubscriptions.$inferSelect | null,
  tierFromPrice: {
    tierName: string;
    billingCycle: "monthly" | "yearly";
  } | null,
  successorWithMarker: typeof userSubscriptions.$inferSelect | null = null,
): ReconciliationOp {
  const userId = readUserIdFromMetadata(subscription);
  if (userId === null) {
    return {
      op: "skip",
      reason: "missing supabase_user_id metadata",
      stripeId: subscription.id,
    };
  }

  // In-flight predecessor: this Stripe sub has no matching local row,
  // but a DIFFERENT local row claims it as its
  // `metadata.old_stripe_subscription_id`. The change-of-tier webhook
  // cleanup for that other row hasn't run yet (delivery outage), or
  // its 3-attempt cancelOldSubscriptionWithRetry retry exhausted and
  // left the marker behind. Skip with a flagged reason rather than
  // INSERTing a phantom row that would either collide with the
  // active-unique index OR create a tie-broken duplicate. See
  // findRowWithOldMarker docstring for the full failure-mode analysis
  // (Inspector Brad PR #70 sweep #7 medium-severity find).
  if (existing === null && successorWithMarker !== null) {
    return {
      op: "skip",
      reason: `in-flight change-of-tier predecessor (successor row ${successorWithMarker.id} still references this id as old_stripe_subscription_id; webhook cleanup outstanding) — declining to create a phantom`,
      stripeId: subscription.id,
    };
  }

  // Resolve tier + cycle from the Stripe PRICE id first (price ids are
  // immutable and authoritative for the active tier). Fall back to
  // metadata only when the price-id lookup didn't find a match — and
  // even then, warn so ops can investigate. Never silently default to
  // basic/monthly when both lookups fail — that would silently downgrade
  // an active premium/yearly row (Inspector Brad PR #70 sweep #4
  // high-severity find).
  const metadataTier = subscription.metadata?.tier_name;
  const metadataCycle = subscription.metadata?.billing_cycle;
  let resolvedTierName: string | null = null;
  let resolvedBillingCycle: string | null = null;
  if (tierFromPrice !== null) {
    resolvedTierName = tierFromPrice.tierName;
    resolvedBillingCycle = tierFromPrice.billingCycle;
  } else if (typeof metadataTier === "string" && metadataTier.length > 0) {
    resolvedTierName = metadataTier;
    resolvedBillingCycle =
      typeof metadataCycle === "string" && metadataCycle.length > 0
        ? metadataCycle
        : "monthly";
    console.warn(
      `[reconcile] ${subscription.id}: price-id lookup missed; falling back to metadata.tier_name=${metadataTier}`,
    );
  }
  // If neither resolved → skip with a clear reason rather than silently
  // writing basic/monthly into the patch.
  if (resolvedTierName === null || resolvedBillingCycle === null) {
    return {
      op: "skip",
      reason: `cannot resolve tier (no price-id match in subscription_tiers, no metadata.tier_name)`,
      stripeId: subscription.id,
    };
  }

  // Grace-period-aware status mapping — mirrors the webhook so an
  // in-grace-period cancel-at-period-end sub stays "active" until the
  // period actually ends (Inspector Brad PR #70 sweep #4
  // medium-severity find).
  const paymentStatus = mapStripeStatusToPaymentStatusForUpdate(subscription);
  const periodEnd = unixSecondsToDate(readCurrentPeriodEnd(subscription));
  const trialEnd = unixSecondsToDate(subscription.trial_end);
  const startsAt = unixSecondsToDate(subscription.created) ?? new Date();
  const cancelledAt = unixSecondsToDate(subscription.canceled_at);
  const customerId = readStripeCustomerId(subscription);
  // Read the active price's currency from Stripe truth. The
  // `user_subscriptions.currency` column has a schema default of "GBP"
  // which fired on every reconciled INSERT before this fix — latent
  // today because every `subscription_tiers` row is seeded GBP, but
  // mass-imports + future non-GBP tiers would silently mis-classify
  // (Inspector Brad PR #70 sweep #6 low-severity find). We omit the
  // field from the patch when missing so the column keeps whatever
  // value the existing row already had, rather than nulling it out.
  const currency = readStripePriceCurrency(subscription);

  if (existing === null) {
    // Skip phantom-row creation for permanently-dead Stripe subs that
    // have no matching local row. See TERMINAL_STRIPE_STATUSES docstring.
    if (TERMINAL_STRIPE_STATUSES.has(subscription.status)) {
      return {
        op: "skip",
        reason: `terminal Stripe status (${subscription.status}) with no matching local row — declining to create a phantom`,
        stripeId: subscription.id,
      };
    }
    return {
      op: "insert",
      stripeId: subscription.id,
      userId,
      payload: {
        userId,
        tierName: resolvedTierName,
        billingCycle: resolvedBillingCycle,
        paymentStatus,
        // Preserve Stripe's `created` as the local `createdAt` rather
        // than letting the schema's `defaultNow()` fire. Otherwise the
        // row's createdAt would skew "now" for historical subs and
        // confuse `findMostRecentForUser`'s createdAt-DESC ordering
        // (defense-in-depth alongside the terminal-status skip above —
        // Inspector Brad PR #70 sweep #3).
        createdAt: startsAt,
        startsAt,
        expiresAt: periodEnd,
        trialEndsAt: trialEnd,
        nextBillingDate: periodEnd,
        cancelledAt,
        externalSubscriptionId: subscription.id,
        ...(currency !== null ? { currency } : {}),
        metadata: {
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          reconciled_at: new Date().toISOString(),
        },
      },
    };
  }

  // UPDATE — preserve PK, overwrite mutable columns from Stripe truth.
  const existingMeta =
    (existing.metadata as Record<string, unknown> | null) ?? {};
  return {
    op: "update",
    stripeId: subscription.id,
    userId,
    localId: existing.id,
    patch: {
      tierName: resolvedTierName,
      billingCycle: resolvedBillingCycle,
      paymentStatus,
      expiresAt: periodEnd,
      trialEndsAt: trialEnd,
      nextBillingDate: periodEnd,
      cancelledAt,
      externalSubscriptionId: subscription.id,
      ...(currency !== null ? { currency } : {}),
      metadata: {
        ...existingMeta,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        reconciled_at: new Date().toISOString(),
      },
    },
  };
}

async function applyOp(op: ReconciliationOp): Promise<void> {
  const db = getDb();
  if (op.op === "skip") return;
  if (op.op === "insert") {
    await db.insert(userSubscriptions).values(op.payload);
    return;
  }
  await db
    .update(userSubscriptions)
    .set({ ...op.patch, updatedAt: new Date() })
    .where(eq(userSubscriptions.id, op.localId));
}

function summarizeOp(op: ReconciliationOp): string {
  if (op.op === "skip") {
    return `SKIP    stripe_sub=${op.stripeId}  reason="${op.reason}"`;
  }
  if (op.op === "insert") {
    return `INSERT  stripe_sub=${op.stripeId}  user=${op.userId}  payment_status=${op.payload.paymentStatus}  tier=${op.payload.tierName}`;
  }
  return `UPDATE  stripe_sub=${op.stripeId}  user=${op.userId}  local=${op.localId}  payment_status=${op.patch.paymentStatus}  tier=${op.patch.tierName}`;
}

// ─── Main ─────────────────────────────────────────────────────────────

/**
 * Counters returned by `reconcile`.
 *
 * `skip/insert/update/total` describe the PLANNED op shape — what
 * `buildOp` decided to do. `applied/failed` describe what actually
 * landed when `--write` was passed; both are 0 in dry-run mode
 * (Inspector Brad PR #70 sweep #5 medium-severity find — previously
 * the summary reported planned counts as "COMMITTED" even when the
 * underlying DB writes errored out, and the exit-code-2 guard only
 * triggered on 100%-skip runs so 100%-failed runs exited 0).
 */
export type ReconcileCounts = {
  skip: number;
  insert: number;
  update: number;
  total: number;
  applied: number;
  failed: number;
};

export async function reconcile(args: CliArgs): Promise<{
  counts: ReconcileCounts;
  ops: ReconciliationOp[];
}> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (typeof stripeKey !== "string" || stripeKey.length === 0) {
    throw new Error("STRIPE_SECRET_KEY env var is required");
  }
  if (
    typeof process.env.DATABASE_URL !== "string" ||
    process.env.DATABASE_URL.length === 0
  ) {
    throw new Error("DATABASE_URL env var is required");
  }

  const stripe = new Stripe(stripeKey);

  const ops: ReconciliationOp[] = [];
  const counts: ReconcileCounts = {
    skip: 0,
    insert: 0,
    update: 0,
    total: 0,
    applied: 0,
    failed: 0,
  };

  for await (const subscription of stripe.subscriptions.list({
    status: "all",
    limit: 100,
  })) {
    // Client-side user-id filter — Stripe's `list` doesn't accept
    // metadata-equality filters, so we fetch the full set and skip
    // here. Acceptable at the expected reconcile scale.
    if (args.userId !== null) {
      const subUserId = readUserIdFromMetadata(subscription);
      if (subUserId !== args.userId) continue;
    }

    counts.total += 1;
    const existing = await findByExternalId(subscription.id);
    const priceId = readStripePriceId(subscription);
    const tierFromPrice =
      priceId !== null ? await resolveTierForPrice(priceId) : null;
    // Only run the (extra) old-marker lookup when we'd otherwise be
    // about to INSERT — non-terminal status + no matching local row.
    // This is the narrow window where sweep #3's terminal-only skip
    // leaves the phantom-row risk open (Inspector Brad PR #70 sweep #7).
    const successorWithMarker =
      existing === null && !TERMINAL_STRIPE_STATUSES.has(subscription.status)
        ? await findRowWithOldMarker(subscription.id)
        : null;
    const op = buildOp(
      subscription,
      existing,
      tierFromPrice,
      successorWithMarker,
    );
    ops.push(op);
    if (op.op === "skip") counts.skip += 1;
    else if (op.op === "insert") counts.insert += 1;
    else counts.update += 1;

    console.log(summarizeOp(op));
    if (!args.dryRun) {
      // `skip` ops have no apply step — they're already terminal.
      if (op.op === "skip") continue;
      try {
        await applyOp(op);
        counts.applied += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ apply failed: ${message}`);
        counts.failed += 1;
      }
    }
  }

  return { counts, ops };
}

// Only run when invoked directly — keeps the module importable for
// tests without firing the side-effect block.
if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  reconcile(args)
    .then(({ counts, ops }) => {
      console.log("");
      // Summary line carries BOTH the planned counts AND, in --write
      // mode, the actually-applied/failed counts. Cron monitors should
      // assert `failed=0` and `applied = insert + update` to catch
      // silent DB-side failures.
      const writeSummary = args.dryRun
        ? "DRY RUN — no DB writes"
        : `applied=${counts.applied} failed=${counts.failed}`;
      console.log(
        `Done. total=${counts.total} insert=${counts.insert} update=${counts.update} skip=${counts.skip} (${writeSummary})`,
      );
      // surface a non-zero exit when every sub was skipped — likely a
      // metadata configuration issue worth alerting on.
      if (counts.total > 0 && counts.skip === counts.total) {
        console.error(
          "All subscriptions were skipped — likely missing supabase_user_id metadata. Investigate before retrying.",
        );
        process.exit(2);
      }
      // Surface a non-zero exit when any apply failed in --write mode.
      // Without this, a run where every UPDATE / INSERT errored out
      // silently exited 0 because the prior guard only fired on the
      // 100%-skip case (Inspector Brad PR #70 sweep #5).
      if (counts.failed > 0) {
        console.error(
          `${counts.failed} of ${counts.applied + counts.failed} writes failed — see the per-op "apply failed:" lines above for details.`,
        );
        process.exit(3);
      }
      void ops;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

// Exported for unit tests.
export const __internals = {
  parseArgs,
  mapStripeStatusToPaymentStatus,
  mapStripeStatusToPaymentStatusForUpdate,
  unixSecondsToDate,
  readCurrentPeriodEnd,
  readUserIdFromMetadata,
  readTierFromMetadata,
  readBillingCycleFromMetadata,
  readStripeCustomerId,
  readStripePriceId,
  readStripePriceCurrency,
  buildOp,
  summarizeOp,
};
