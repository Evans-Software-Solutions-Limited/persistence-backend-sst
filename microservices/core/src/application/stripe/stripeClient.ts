import Stripe from "stripe";
import { getEnv } from "@persistence/api-utils/env";

/**
 * Lazy-init Stripe SDK singleton.
 *
 * Why lazy: `getEnv("STRIPE_SECRET_KEY")` throws if the env var is missing,
 * which would crash at module-import time and take down unrelated unit
 * tests that don't touch Stripe. Constructing on first access lets test
 * suites mock or stub callers without the env var being present.
 *
 * apiVersion intentionally NOT pinned. Two reasons:
 *   1. Inbound webhook events ship in whatever API version is configured
 *      on the Stripe-dashboard webhook endpoint, NOT the SDK's apiVersion.
 *      So pinning here would be misleading for the inbound path.
 *   2. The SDK's StripeConfig type advances its apiVersion literal with
 *      every SDK release, breaking the pin against any older string. The
 *      legacy edge function pinned "2023-10-16"; we accept whatever the
 *      SDK defaults to and rely on the dashboard-level config for the
 *      inbound side. Outbound code can override per-call if needed.
 *
 * spec 17 / Phase D (audit LOW-2): re-evaluated and DELIBERATELY kept
 * unpinned. Pinning the SDK `apiVersion` is the fragile option here — it
 * fights the SDK's advancing type literal and is misleading for the inbound
 * path (dashboard-controlled). The version-resilient field reads in
 * `eventHandlers/_helpers.ts` (`readCurrentPeriodEnd`, `readInvoiceSubscriptionId`)
 * are the real defence against Stripe field-shape migrations. The control to
 * manage is the dashboard webhook endpoint's API version, not this line.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe === null) {
    _stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"));
  }
  return _stripe;
}

/**
 * Webhook signing secret used by `stripe.webhooks.constructEventAsync`.
 * Separate from the API key — rotates independently when the Stripe
 * webhook endpoint is regenerated. Lazy-read for the same test-isolation
 * reason as `getStripe`.
 */
export function getStripeWebhookSecret(): string {
  return getEnv("STRIPE_WEBHOOK_SECRET");
}

/**
 * Reset the cached Stripe singleton. Test-only — production code never
 * needs this. Exposed because some test suites mock the SDK via
 * `vi.mock("stripe", ...)` AFTER the singleton has been constructed,
 * and re-reading the mock requires clearing the cache.
 */
export function __resetStripeClientForTests(): void {
  _stripe = null;
}
