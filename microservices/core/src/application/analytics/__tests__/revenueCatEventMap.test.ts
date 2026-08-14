import { describe, it, expect } from "vitest";
import { mapRevenueCatEventToAnalytics } from "../revenueCatEventMap";

describe("mapRevenueCatEventToAnalytics", () => {
  it("maps a trial INITIAL_PURCHASE to trial_started", () => {
    const out = mapRevenueCatEventToAnalytics({
      type: "INITIAL_PURCHASE",
      period_type: "TRIAL",
    });
    expect(out?.name).toBe("trial_started");
    expect(out?.source).toBe("app");
    expect(out?.properties?.period_type).toBe("TRIAL");
  });

  it("maps a non-trial INITIAL_PURCHASE to subscription_purchased with value+currency", () => {
    const out = mapRevenueCatEventToAnalytics({
      type: "INITIAL_PURCHASE",
      period_type: "NORMAL",
      price: 12.99,
      currency: "GBP",
      store: "APP_STORE",
      product_id: "premium_monthly",
    });
    expect(out?.name).toBe("subscription_purchased");
    expect(out?.properties).toMatchObject({
      value: 12.99,
      currency: "GBP",
      store: "APP_STORE",
      product_id: "premium_monthly",
      period_type: "NORMAL",
    });
  });

  it("maps NON_RENEWING_PURCHASE to subscription_purchased", () => {
    expect(
      mapRevenueCatEventToAnalytics({ type: "NON_RENEWING_PURCHASE" })?.name,
    ).toBe("subscription_purchased");
  });

  it("maps RENEWAL / CANCELLATION / EXPIRATION", () => {
    expect(mapRevenueCatEventToAnalytics({ type: "RENEWAL" })?.name).toBe(
      "renewal",
    );
    expect(mapRevenueCatEventToAnalytics({ type: "CANCELLATION" })?.name).toBe(
      "cancellation",
    );
    expect(mapRevenueCatEventToAnalytics({ type: "EXPIRATION" })?.name).toBe(
      "expiration",
    );
  });

  it("returns null for types with no funnel meaning", () => {
    expect(mapRevenueCatEventToAnalytics({ type: "TRANSFER" })).toBeNull();
    expect(
      mapRevenueCatEventToAnalytics({ type: "PRODUCT_CHANGE" }),
    ).toBeNull();
    expect(
      mapRevenueCatEventToAnalytics({ type: "UNCANCELLATION" }),
    ).toBeNull();
  });

  it("returns null when type is missing / not a string", () => {
    expect(mapRevenueCatEventToAnalytics({})).toBeNull();
    expect(mapRevenueCatEventToAnalytics({ type: 42 })).toBeNull();
  });

  it("drops malformed value/currency defensively (no NaN, no non-string currency)", () => {
    const out = mapRevenueCatEventToAnalytics({
      type: "RENEWAL",
      price: "not-a-number",
      currency: 999,
      store: "",
    });
    expect(out?.name).toBe("renewal");
    expect(out?.properties).not.toHaveProperty("value");
    expect(out?.properties).not.toHaveProperty("currency");
    // empty-string store is dropped too
    expect(out?.properties).not.toHaveProperty("store");
  });

  it("emits value even when it is 0 (finite) but omits when non-finite", () => {
    expect(
      mapRevenueCatEventToAnalytics({ type: "RENEWAL", price: 0 })?.properties,
    ).toMatchObject({ value: 0 });
    expect(
      mapRevenueCatEventToAnalytics({ type: "RENEWAL", price: Infinity })
        ?.properties,
    ).not.toHaveProperty("value");
  });
});
