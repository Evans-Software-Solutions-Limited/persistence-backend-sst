import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Tests for the stripeClient singleton accessors. Every other test in
 * this suite mocks `getStripe` directly — by design, since they don't
 * need a real Stripe SDK instance. This file is the one place that
 * exercises the real getStripe / getStripeWebhookSecret / reset path,
 * so the module itself reaches coverage parity with the rest of the
 * Stripe layer.
 */

const ORIGINAL_SECRET = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_WEBHOOK = process.env.STRIPE_WEBHOOK_SECRET;

describe("stripeClient", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit";
  });

  afterEach(async () => {
    // Reset both the cached singleton AND the env vars between tests so
    // the lazy-init path is exercised each time.
    const { __resetStripeClientForTests } = await import("../stripeClient");
    __resetStripeClientForTests();
    process.env.STRIPE_SECRET_KEY = ORIGINAL_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_WEBHOOK;
  });

  it("getStripe() returns a Stripe instance with the secret-key env value", async () => {
    const { getStripe } = await import("../stripeClient");
    const stripe = getStripe();
    // We don't want to bind to Stripe's internal class shape; just verify
    // it's a usable object that exposes the methods we actually call.
    expect(typeof stripe.subscriptions.retrieve).toBe("function");
    expect(typeof stripe.subscriptions.cancel).toBe("function");
    expect(typeof stripe.webhooks.constructEventAsync).toBe("function");
  });

  it("getStripe() returns the same singleton across calls", async () => {
    const { getStripe } = await import("../stripeClient");
    const a = getStripe();
    const b = getStripe();
    expect(a).toBe(b);
  });

  it("__resetStripeClientForTests() forces the next getStripe() to re-read the env", async () => {
    const { getStripe, __resetStripeClientForTests } =
      await import("../stripeClient");
    const a = getStripe();
    __resetStripeClientForTests();
    const b = getStripe();
    expect(a).not.toBe(b);
  });

  it("getStripeWebhookSecret() returns the STRIPE_WEBHOOK_SECRET env value", async () => {
    const { getStripeWebhookSecret } = await import("../stripeClient");
    expect(getStripeWebhookSecret()).toBe("whsec_unit");
  });

  it("getStripe() throws when STRIPE_SECRET_KEY is missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { getStripe, __resetStripeClientForTests } =
      await import("../stripeClient");
    __resetStripeClientForTests();
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("getStripeWebhookSecret() throws when STRIPE_WEBHOOK_SECRET is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { getStripeWebhookSecret } = await import("../stripeClient");
    expect(() => getStripeWebhookSecret()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});
