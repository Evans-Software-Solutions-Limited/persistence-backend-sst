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
import { eq } from "drizzle-orm";
import { userSubscriptions } from "@persistence/db";
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
  return subscription.metadata?.tier_name ?? "basic";
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
): ReconciliationOp {
  const userId = readUserIdFromMetadata(subscription);
  if (userId === null) {
    return {
      op: "skip",
      reason: "missing supabase_user_id metadata",
      stripeId: subscription.id,
    };
  }

  const paymentStatus = mapStripeStatusToPaymentStatus(subscription.status);
  const periodEnd = unixSecondsToDate(readCurrentPeriodEnd(subscription));
  const trialEnd = unixSecondsToDate(subscription.trial_end);
  const startsAt = unixSecondsToDate(subscription.created) ?? new Date();
  const cancelledAt = unixSecondsToDate(subscription.canceled_at);
  const customerId = readStripeCustomerId(subscription);

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
        tierName: readTierFromMetadata(subscription),
        billingCycle: readBillingCycleFromMetadata(subscription),
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
      tierName: readTierFromMetadata(subscription),
      billingCycle: readBillingCycleFromMetadata(subscription),
      paymentStatus,
      expiresAt: periodEnd,
      trialEndsAt: trialEnd,
      nextBillingDate: periodEnd,
      cancelledAt,
      externalSubscriptionId: subscription.id,
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

export async function reconcile(args: CliArgs): Promise<{
  counts: { skip: number; insert: number; update: number; total: number };
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
  const counts = { skip: 0, insert: 0, update: 0, total: 0 };

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
    const op = buildOp(subscription, existing);
    ops.push(op);
    if (op.op === "skip") counts.skip += 1;
    else if (op.op === "insert") counts.insert += 1;
    else counts.update += 1;

    console.log(summarizeOp(op));
    if (!args.dryRun) {
      try {
        await applyOp(op);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ apply failed: ${message}`);
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
      console.log(
        `Done. total=${counts.total} insert=${counts.insert} update=${counts.update} skip=${counts.skip} (${args.dryRun ? "DRY RUN — no DB writes" : "COMMITTED"})`,
      );
      // surface a non-zero exit when every sub was skipped — likely a
      // metadata configuration issue worth alerting on.
      if (counts.total > 0 && counts.skip === counts.total) {
        console.error(
          "All subscriptions were skipped — likely missing supabase_user_id metadata. Investigate before retrying.",
        );
        process.exit(2);
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
  unixSecondsToDate,
  readCurrentPeriodEnd,
  readUserIdFromMetadata,
  readTierFromMetadata,
  readBillingCycleFromMetadata,
  readStripeCustomerId,
  buildOp,
  summarizeOp,
};
