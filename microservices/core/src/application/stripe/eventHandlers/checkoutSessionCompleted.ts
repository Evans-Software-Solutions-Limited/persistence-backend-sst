import type Stripe from "stripe";
import { emitStripeAlert } from "../alerts";
import { emitEvent } from "../../analytics/emitEvent";
import { AdminAuditRepository } from "../../repositories/adminAuditRepository";
import { FoundingCheckoutRepository } from "../../repositories/foundingCheckoutRepository";
import { FoundingGrantService } from "../../founding/foundingGrantService";
import { FOUNDING_WEB_ACTOR_ID } from "../../founding/foundingOffer";
import { RESEND_NOTIFICATION_TO, sendEmail } from "../../leads/resendClient";

/**
 * `checkout.session.completed` (and `checkout.session.async_payment_succeeded`,
 * which shares this handler) — a founding purchase on the website has been
 * paid for (FOUNDING-OFFER BRIEF § 2, 2026-09-05 amendment).
 *
 * This is where money becomes access. It creates an ordinary
 * `founding_grants` row through the SAME service `/admin` uses, so the pool
 * accounting, the referral claim, the invite email and applying a pending grant
 * on sign-up all behave identically whether Brad granted it by hand or a
 * stranger bought it at 2am.
 *
 * ─── Idempotency ───
 *
 * Webhook delivery is at-least-once and two deliveries can be in flight at the
 * same moment, so this does NOT read-then-write. `claimForCompletion` flips the
 * row `open → completed` in one conditional UPDATE and only the caller it
 * returns a row to goes on to grant. A redelivery finds nothing to claim and
 * returns quietly, which is also what makes it safe to replay this event by
 * hand.
 *
 * ─── The one case a webhook must not decide ───
 *
 * A grant cannot displace a live App Store subscription (BRIEF D3), so if the
 * buyer already has one the grant is refused. Retrying would never help: the
 * store subscription will still be there next time, and Stripe would keep
 * redelivering for days. The session is left `completed` (the money is real),
 * an audit row and an ops alert are written, and Brad settles it by hand —
 * override the grant, or refund. Anything else either loses the payment or
 * spins forever.
 */
export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  // Async payment methods complete later via `checkout.session.async_payment_
  // succeeded`; an unpaid completion is not a purchase.
  if (session.payment_status !== "paid") return;

  const checkouts = new FoundingCheckoutRepository();
  const claimed = await checkouts.claimForCompletion(session.id);
  // Either not one of ours (the account handles other Checkout flows) or
  // already processed. Both are no-ops.
  if (!claimed) return;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  const amountMinor = session.amount_total ?? claimed.amountMinor;
  const currency = (session.currency ?? claimed.currency).toUpperCase();

  // The claim above has already flipped the row to `completed`, so a THROW
  // from here on would be unrecoverable: the retry's claim finds nothing open,
  // returns null, and the handler exits quietly — payment taken, no grant, no
  // audit row, nothing watching. A connection blip or a lock timeout is enough
  // to trigger it. So a throw is turned into the same visible needs-review
  // state a refusal produces, and only then rethrown so Stripe still retries.
  const grantRequest = {
    email: claimed.email,
    tierName: claimed.tierName,
    grantKind: "founding" as const,
    months: claimed.months,
    contributionAmountMinor: amountMinor,
    contributionCurrency: currency,
    contributionMethod: "stripe_checkout" as const,
    contributionReference: paymentIntentId,
    contributedAt: new Date(),
    referralCode: claimed.referralCode,
    notes: `web checkout ${session.id}`,
    sendInvite: true,
  };

  let outcome;
  try {
    outcome = await new FoundingGrantService().grant(
      grantRequest,
      FOUNDING_WEB_ACTOR_ID,
    );
  } catch (err) {
    await flagForReview(
      claimed.id,
      session.id,
      claimed.email,
      `grant_threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }

  // Attribution yields to access. A code that no longer resolves, or a buyer
  // whose account is already locked to a different one, must not cost them the
  // thing they have paid for (BRIEF D6) — so the grant is retried once without
  // it and the dropped attribution is recorded rather than the sale refused.
  let droppedReferral: string | null = null;
  if (
    !outcome.ok &&
    (outcome.error.code === "invalid_referral_code" ||
      outcome.error.code === "referral_locked_elsewhere")
  ) {
    emitStripeAlert("founding_checkout.referral_dropped", "warn", {
      checkoutId: claimed.id,
      stripeSessionId: session.id,
      referralCode: claimed.referralCode,
      reason: outcome.error.code,
    });
    // Clear it on the row too. The grant credits nobody, so leaving the code
    // here would have the admin attribution and the analytics both credit a
    // partner with a sale their code did not earn.
    droppedReferral = claimed.referralCode;
    try {
      await checkouts.clearReferral(claimed.id);
    } catch (err) {
      console.error(
        `[founding:checkout] could not clear the dropped referral: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      outcome = await new FoundingGrantService().grant(
        { ...grantRequest, referralCode: null },
        FOUNDING_WEB_ACTOR_ID,
      );
    } catch (err) {
      await flagForReview(
        claimed.id,
        session.id,
        claimed.email,
        `grant_threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  if (!outcome.ok) {
    await flagForReview(
      claimed.id,
      session.id,
      claimed.email,
      outcome.error.code,
    );
    return;
  }

  // Guarded, like the needs-review writes and for the same reason: a throw
  // here 500s the webhook, Stripe redelivers, and the redelivery finds the row
  // already `completed` and returns quietly. The grant would exist while
  // `grant_id` never got set — so the refund path could not find it, and the
  // conversion below would never be emitted, with nothing saying so.
  try {
    await checkouts.attachGrant(claimed.id, outcome.result.grantId);
  } catch (err) {
    emitStripeAlert("founding_checkout.attach_grant_failed", "critical", {
      checkoutId: claimed.id,
      grantId: outcome.result.grantId,
      stripeSessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // A card session always carries one. Without it the grant has no payment
  // reference, so a later refund cannot find it and access would survive the
  // money going back.
  if (!paymentIntentId) {
    emitStripeAlert("founding_checkout.no_payment_reference", "critical", {
      checkoutId: claimed.id,
      stripeSessionId: session.id,
      grantId: outcome.result.grantId,
    });
  }

  // The conversion. `purchase` maps to Meta's `Purchase`; the browser fires the
  // same event id from the thanks page so the two dedupe.
  await emitEvent({
    name: "purchase",
    source: "web",
    eventId: claimed.eventId ?? undefined,
    properties: {
      marketing_consent: claimed.marketingConsent,
      value: amountMinor / 100,
      currency,
      tier: claimed.tierName,
      months: claimed.months,
      ...(claimed.fbc ? { fbc: claimed.fbc } : {}),
      ...(claimed.fbp ? { fbp: claimed.fbp } : {}),
      ...(claimed.campaignSlug ? { campaign: claimed.campaignSlug } : {}),
      ...(claimed.referralCode && droppedReferral === null
        ? { ref: claimed.referralCode }
        : {}),
    },
  });
}

/**
 * The payment stands but access could not be granted. Record it where Brad
 * will see it and stop — never retry, never refund automatically.
 */
async function flagForReview(
  checkoutId: string,
  stripeSessionId: string,
  email: string,
  reason: string,
): Promise<void> {
  emitStripeAlert("founding_checkout.needs_review", "critical", {
    checkoutId,
    stripeSessionId,
    reason,
  });
  // Guarded, despite being the durable record — BECAUSE it is. The likeliest
  // trigger for the throw path is the database itself (pooler saturation, a
  // lock timeout), and `record` uses the same pool the failed grant did. An
  // unguarded write would fail for the same reason, take the alert email and
  // the rethrow with it, and leave one log line as the entire trail.
  try {
    await new AdminAuditRepository().record({
      actorId: FOUNDING_WEB_ACTOR_ID,
      action: "founding_checkout.needs_review",
      entityType: "founding_checkout_session",
      entityId: checkoutId,
      after: { stripeSessionId, reason },
      reason,
    });
  } catch (err) {
    console.error(
      `[founding:checkout] needs-review audit write failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  // Best-effort for the same reason: a Resend outage must not fail the webhook
  // and start Stripe retrying a payment we have already accepted.
  try {
    await sendEmail({
      to: RESEND_NOTIFICATION_TO,
      subject: "Founding checkout needs review",
      text: [
        `A founding purchase was paid for but access could not be granted.`,
        ``,
        `Email: ${email}`,
        `Reason: ${reason}`,
        `Stripe session: ${stripeSessionId}`,
        ``,
        `Resolve it by hand in /admin — grant access once any store`,
        `subscription has expired, or refund the payment in Stripe.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error(
      `[founding:checkout] needs-review email failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
