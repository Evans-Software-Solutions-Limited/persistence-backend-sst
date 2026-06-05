import type Stripe from "stripe";
import {
  mapStripeStatusToPaymentStatusForUpdate,
  readUserIdFromMetadata,
} from "../eventHandlers/_helpers";

/**
 * Read-only drift DETECTION between Stripe (source of truth for money state)
 * and the local `user_subscriptions` mirror (spec 17 / Phase B, closes audit
 * HIGH-3 — "reconciliation exists but isn't scheduled and doesn't alert").
 *
 * This is the *detect + alert* counterpart to the manual `scripts/
 * reconcile-stripe.ts` heal tool. It writes NOTHING — it diffs and reports, so
 * it can run unattended on a schedule and raise an alert when Stripe and the
 * DB disagree (webhook missed / dropped / mis-processed). Healing stays a
 * deliberate, reviewed op.
 *
 * The runner is dependency-injected (`ReconcileDeps`) so the aggregation logic
 * is unit-testable without a live Stripe account or DB.
 */

export type DriftKind = "missing_local_row" | "field_mismatch";

export interface DriftFinding {
  kind: DriftKind;
  stripeSubscriptionId: string;
  userId: string;
  /** For `field_mismatch`: which entitlement-relevant fields differ. */
  fields?: Array<{
    field: string;
    stripe: string | null;
    local: string | null;
  }>;
}

export interface ReconcileCounts {
  total: number;
  ok: number;
  drift: number;
  skipped: number; // no supabase_user_id metadata — config issue, not drift
}

export interface ReconcileDetectResult {
  hasDrift: boolean;
  counts: ReconcileCounts;
  findings: DriftFinding[];
}

/** Minimal local-row shape the diff needs. */
export interface LocalSubscriptionView {
  tierName: string;
  paymentStatus: string | null;
}

export interface ReconcileDeps {
  /** Paginated Stripe subscriptions (status: "all"). */
  listSubscriptions: () => AsyncIterable<Stripe.Subscription>;
  /** Local row lookup by Stripe subscription id, or null when absent. */
  findByExternalId: (
    stripeSubscriptionId: string,
  ) => Promise<LocalSubscriptionView | null>;
  /** Map a Stripe price id → local tier name, or null when unknown. */
  resolveTierForPrice: (priceId: string) => Promise<string | null>;
}

/**
 * Stripe statuses that represent a permanently-dead sub. A missing local row
 * for one of these is NOT drift — the change-of-tier flow repurposes local
 * rows in place, so historical canceled subs legitimately have no local row
 * (mirrors `reconcile-stripe.ts:TERMINAL_STRIPE_STATUSES`).
 */
const TERMINAL_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "incomplete_expired",
]);

function readPriceId(subscription: Stripe.Subscription): string | null {
  const id = subscription.items?.data?.[0]?.price?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Pure diff for a single Stripe subscription against its local row. Returns a
 * `DriftFinding` when Stripe and the DB disagree on entitlement-relevant state,
 * or `null` when they agree (or when an absent local row is expected).
 *
 * Compares the two fields that actually drive entitlement: `payment_status`
 * (grace-period-aware mapping) and `tier_name` (resolved from the immutable
 * Stripe price id — only when resolvable, so an unknown price never
 * false-flags). Timestamp fields are intentionally NOT compared — they're
 * high-noise and don't gate access.
 */
export function diffSubscription(
  subscription: Stripe.Subscription,
  local: LocalSubscriptionView | null,
  tierFromPrice: string | null,
): DriftFinding | null {
  const userId = readUserIdFromMetadata(subscription);
  if (userId === null) return null; // handled as `skipped` by the runner

  if (local === null) {
    if (TERMINAL_STATUSES.has(subscription.status)) return null;
    return {
      kind: "missing_local_row",
      stripeSubscriptionId: subscription.id,
      userId,
    };
  }

  const fields: NonNullable<DriftFinding["fields"]> = [];

  const expectedStatus = mapStripeStatusToPaymentStatusForUpdate(subscription);
  if ((local.paymentStatus ?? null) !== expectedStatus) {
    fields.push({
      field: "payment_status",
      stripe: expectedStatus,
      local: local.paymentStatus ?? null,
    });
  }

  if (tierFromPrice !== null && local.tierName !== tierFromPrice) {
    fields.push({
      field: "tier_name",
      stripe: tierFromPrice,
      local: local.tierName,
    });
  }

  if (fields.length === 0) return null;
  return {
    kind: "field_mismatch",
    stripeSubscriptionId: subscription.id,
    userId,
    fields,
  };
}

/**
 * Run a full read-only reconciliation sweep. Returns drift findings + counts;
 * `hasDrift` is the alert signal the cron raises on.
 */
export async function reconcileDetect(
  deps: ReconcileDeps,
): Promise<ReconcileDetectResult> {
  const findings: DriftFinding[] = [];
  const counts: ReconcileCounts = { total: 0, ok: 0, drift: 0, skipped: 0 };

  for await (const subscription of deps.listSubscriptions()) {
    counts.total += 1;

    if (readUserIdFromMetadata(subscription) === null) {
      counts.skipped += 1;
      continue;
    }

    const local = await deps.findByExternalId(subscription.id);
    const priceId = readPriceId(subscription);
    const tierFromPrice =
      priceId !== null ? await deps.resolveTierForPrice(priceId) : null;

    const finding = diffSubscription(subscription, local, tierFromPrice);
    if (finding === null) {
      counts.ok += 1;
    } else {
      counts.drift += 1;
      findings.push(finding);
    }
  }

  return { hasDrift: counts.drift > 0, counts, findings };
}
