import type Stripe from "stripe";
import { emitEvent } from "../analytics/emitEvent";
import { emitStripeAlert } from "../stripe/alerts";
import { reportTradedoublerSale } from "../tradedoubler/reportSale";
import { BLC_CHANNEL } from "./blcOffer";

/**
 * `checkout.session.completed` for a Blue Light Card Session.
 *
 * Nothing here creates access. The subscription itself is mirrored into
 * `user_subscriptions` by `customer.subscription.created`, which reads the
 * `subscription_data.metadata` the checkout stamped (`supabase_user_id`,
 * `tier_name`, `billing_cycle`). This handler owns the two things that only
 * the SESSION knows: the affiliate conversion for Tradedoubler, and the
 * `purchase` analytics event with the browser's dedup id.
 *
 * Both are best-effort. A Tradedoubler outage is logged and alerted, never
 * thrown — a 500 here would make Stripe redeliver a payment we have already
 * accepted, and the subscription handlers would run again for nothing.
 */
export function isBlcCheckoutSession(
  session: Pick<Stripe.Checkout.Session, "metadata">,
): boolean {
  return session.metadata?.channel === BLC_CHANNEL;
}

export async function handleBlcCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  // A subscription Session on a card pays up front. Anything else (an unpaid
  // async method, a 100 % coupon) is not a sale to report.
  if (session.payment_status !== "paid") {
    console.log(
      `[blc:checkout] ${session.id} completed with payment_status=${session.payment_status} — nothing to report`,
    );
    return;
  }

  const metadata = session.metadata ?? {};
  const amountMinor = session.amount_total ?? 0;
  const currency = (session.currency ?? "gbp").toUpperCase();

  const report = await reportTradedoublerSale({
    orderNumber: session.id,
    orderValueMinor: amountMinor,
    currency,
    voucher: metadata.voucher ?? "",
    tduid: metadata.tduid ?? "",
  });
  if (!report.skipped && !report.ok) {
    // The sale stands; the partner just has not heard about it. Brad can
    // re-report by hand from the Session id.
    emitStripeAlert("blc_checkout.tradedoubler_report_failed", "warn", {
      stripeSessionId: session.id,
      status: report.status,
      voucher: metadata.voucher ?? "",
    });
  }

  // The conversion. `purchase` maps to Meta's `Purchase`; the thanks page
  // fires the same event id from the browser so the two dedupe.
  await emitEvent({
    name: "purchase",
    source: "web",
    eventId: metadata.event_id || `blc-purchase:${session.id}`,
    properties: {
      marketing_consent: metadata.marketing_consent === "true",
      channel: BLC_CHANNEL,
      tier: metadata.tier ?? null,
      cadence: metadata.cadence ?? null,
      value: amountMinor / 100,
      currency,
      ...(metadata.fbc ? { fbc: metadata.fbc } : {}),
      ...(metadata.fbp ? { fbp: metadata.fbp } : {}),
      ...(metadata.campaign_slug ? { campaign: metadata.campaign_slug } : {}),
    },
  });
}
