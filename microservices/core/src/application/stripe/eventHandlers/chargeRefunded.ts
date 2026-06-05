import type Stripe from "stripe";
import { emitStripeAlert } from "../alerts";

/**
 * Handler for `charge.refunded` (spec 17 / Phase C, closes part of audit
 * MED-3 — refunds were previously invisible to the backend).
 *
 * Emits an ops alert so a refund is surfaced for review. It does NOT auto-
 * revoke entitlement: whether a refund should end access is a business-policy
 * call (full vs partial, goodwill vs dispute-driven) that belongs to a
 * reviewed op, not a webhook side effect. Revocation policy is deferred and
 * documented in specs/17-payments-reliability/design.md.
 *
 * Idempotent: pure alert, no DB write — a redelivered event re-logs harmlessly.
 */
export async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const fullyRefunded = charge.amount_refunded >= charge.amount;
  emitStripeAlert("charge.refunded", fullyRefunded ? "critical" : "warn", {
    chargeId: charge.id,
    customer:
      typeof charge.customer === "string"
        ? charge.customer
        : (charge.customer?.id ?? null),
    amount: charge.amount,
    amountRefunded: charge.amount_refunded,
    currency: charge.currency,
    fullyRefunded,
  });
  return Promise.resolve();
}
