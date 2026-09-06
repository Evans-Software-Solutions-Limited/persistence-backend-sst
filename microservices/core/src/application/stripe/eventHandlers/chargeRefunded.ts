import type Stripe from "stripe";
import { emitStripeAlert } from "../alerts";
import { FoundingCheckoutRepository } from "../../repositories/foundingCheckoutRepository";
import { FoundingGrantRepository } from "../../repositories/foundingGrantRepository";
import { FoundingGrantService } from "../../founding/foundingGrantService";
import { FOUNDING_WEB_ACTOR_ID } from "../../founding/foundingOffer";

/**
 * Handler for `charge.refunded` (spec 17 / Phase C, closes part of audit
 * MED-3 — refunds were previously invisible to the backend).
 *
 * Emits an ops alert so a refund is surfaced for review. For SUBSCRIPTION
 * refunds it still does not auto-revoke entitlement: whether a refund should
 * end recurring access is a business-policy call (full vs partial, goodwill vs
 * dispute-driven) that belongs to a reviewed op, not a webhook side effect.
 * Revocation policy is deferred and documented in
 * specs/17-payments-reliability/design.md.
 *
 * FOUNDING WEB PURCHASES are the exception, added with the 2026-09-05
 * amendment. There the charge bought one fixed term of access outright, so a
 * FULL refund and continued access cannot both be right — the money has gone
 * back and nothing else is owed. That case revokes the grant and marks the
 * checkout `refunded`.
 *
 * A PARTIAL refund does not revoke. It is most often a goodwill gesture on a
 * term someone is still using, and silently cutting their access off because
 * £5 went back would be worse than leaving it to Brad — the alert already puts
 * it in front of him.
 *
 * Idempotent: revocation is skipped once the grant is already revoked, so a
 * redelivered event re-alerts harmlessly and changes nothing.
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

  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);
  if (!paymentIntentId) return;

  const grant = await new FoundingGrantRepository().findLiveByPaymentReference(
    paymentIntentId,
  );
  if (!grant) return;

  if (!fullyRefunded) {
    emitStripeAlert("founding_checkout.partial_refund", "warn", {
      chargeId: charge.id,
      grantId: grant.id,
      amount: charge.amount,
      amountRefunded: charge.amount_refunded,
    });
    return;
  }

  const revoked = await new FoundingGrantService().revoke(
    grant.id,
    `refund ${charge.id}`,
    FOUNDING_WEB_ACTOR_ID,
  );
  if (!revoked.ok) {
    emitStripeAlert("founding_checkout.revoke_failed", "critical", {
      chargeId: charge.id,
      grantId: grant.id,
      reason: revoked.error,
    });
    return;
  }

  const checkouts = new FoundingCheckoutRepository();
  const session = await checkouts.findCompletedByGrantId(grant.id);
  if (session) await checkouts.markRefunded(session.id);
}
