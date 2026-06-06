import type Stripe from "stripe";
import { emitStripeAlert } from "../alerts";

/**
 * Handler for `charge.dispute.created` (spec 17 / Phase C, closes part of
 * audit MED-3). A dispute (chargeback) is a high-signal fraud / unhappy-
 * customer event that always needs a human — Stripe imposes a response
 * deadline and a fee. We emit a `critical` ops alert so it's never missed.
 *
 * Like refunds, we do NOT auto-mutate subscription state here (revocation /
 * suspension on dispute is a reviewed policy call). Idempotent: pure alert.
 */
export async function handleChargeDisputeCreated(
  event: Stripe.Event,
): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  emitStripeAlert("charge.dispute.created", "critical", {
    disputeId: dispute.id,
    charge:
      typeof dispute.charge === "string"
        ? dispute.charge
        : (dispute.charge?.id ?? null),
    amount: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason,
    status: dispute.status,
  });
  return Promise.resolve();
}
