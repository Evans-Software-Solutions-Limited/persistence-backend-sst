/**
 * Payment-status state machine (spec 17 / Phase D, closes audit MED-1).
 *
 * The local `user_subscriptions.payment_status` was governed only by ad-hoc
 * per-handler guards (`deriveInvoicePaidStatus`, the `…ForUpdate` mapping,
 * etc.). Those defend the *known* out-of-order races, but there was no single
 * allowed-transition policy — so a new event type or handler could move the
 * row backwards (the classic "delayed webhook flips cancelled → active" bug).
 *
 * This module is that single policy. It deliberately encodes a MINIMAL,
 * non-destructive rule: a TERMINAL status (the user's sub has ended) may not
 * be revived into a LIVE status by an inbound webhook. Everything else is
 * allowed, so legitimate transitions (recovery `past_due → active`, scheduling
 * `active → cancelled`, idempotent same-state re-writes) pass untouched.
 *
 * Reinstatement (`cancelled → active`) is driven by the OUTBOUND endpoint,
 * which writes the row directly — not by a webhook — so blocking that
 * transition on the inbound path is exactly the protection we want and does
 * not impede the real reinstate flow.
 */

/** Terminal local statuses — the subscription has ended. */
const TERMINAL_STATUSES = new Set<string>(["cancelled", "canceled", "expired"]);

/** Live (entitled-or-recoverable) local statuses. */
const LIVE_STATUSES = new Set<string>([
  "active",
  "trialing",
  "past_due",
  "pending",
]);

/**
 * Whether an inbound webhook may move `from` → `to`.
 *
 * - Unknown / empty `from` (no prior row state) → allow (conservative; nothing
 *   to protect yet).
 * - Same status → allow (idempotent re-delivery).
 * - TERMINAL → LIVE → BLOCK (a stale event must not revive an ended sub).
 * - everything else → allow.
 */
export function canTransition(
  from: string | null | undefined,
  to: string,
): boolean {
  if (from === null || from === undefined || from.length === 0) return true;
  if (from === to) return true;
  if (TERMINAL_STATUSES.has(from) && LIVE_STATUSES.has(to)) return false;
  return true;
}

export interface ResolvedTransition {
  /** The status to actually persist. */
  status: string;
  /** True when `proposed` was an illegal transition and was suppressed. */
  blocked: boolean;
}

/**
 * Resolve the status to write for an inbound webhook update: the `proposed`
 * status when the transition is legal, otherwise keep `existing` (and flag
 * `blocked` so the caller can alert). Never throws — payment webhooks must not
 * 500 on a policy decision; suppressing the bad write + alerting is correct.
 */
export function reconcilePaymentStatus(
  existing: string | null | undefined,
  proposed: string,
): ResolvedTransition {
  if (canTransition(existing, proposed)) {
    return { status: proposed, blocked: false };
  }
  return { status: existing as string, blocked: true };
}

export const __testing = { TERMINAL_STATUSES, LIVE_STATUSES };
