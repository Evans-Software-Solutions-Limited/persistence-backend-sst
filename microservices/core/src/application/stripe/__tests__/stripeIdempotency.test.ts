import { describe, expect, it } from "vitest";
import {
  deriveCancelBaseKey,
  deriveSubscriptionBaseKey,
  opKey,
} from "../stripeIdempotency";

describe("stripeIdempotency", () => {
  describe("deriveSubscriptionBaseKey", () => {
    const base = {
      userId: "user-1",
      tierName: "premium",
      billingCycle: "monthly",
      paymentMethodId: "pm_card",
      existingExternalSubscriptionId: null,
    };

    it("uses a provided client key verbatim (trimmed)", () => {
      expect(
        deriveSubscriptionBaseKey({ ...base, clientKey: "  client-abc  " }),
      ).toBe("client-abc");
    });

    it("ignores empty / whitespace / non-string client keys and falls back", () => {
      const determ = deriveSubscriptionBaseKey({ ...base, clientKey: null });
      expect(deriveSubscriptionBaseKey({ ...base, clientKey: "   " })).toBe(
        determ,
      );
      expect(deriveSubscriptionBaseKey({ ...base, clientKey: "" })).toBe(
        determ,
      );
    });

    it("is DETERMINISTIC: identical intent → identical key (retry-safe)", () => {
      expect(deriveSubscriptionBaseKey(base)).toBe(
        deriveSubscriptionBaseKey({ ...base }),
      );
    });

    it("is DISTINCT across tier, cycle, and payment method", () => {
      const k = deriveSubscriptionBaseKey(base);
      expect(deriveSubscriptionBaseKey({ ...base, tierName: "free" })).not.toBe(
        k,
      );
      expect(
        deriveSubscriptionBaseKey({ ...base, billingCycle: "yearly" }),
      ).not.toBe(k);
      expect(
        deriveSubscriptionBaseKey({ ...base, paymentMethodId: "pm_other" }),
      ).not.toBe(k);
    });

    it("treats a missing payment method as the literal 'default' (no-PM change path)", () => {
      const withDefault = deriveSubscriptionBaseKey({
        ...base,
        paymentMethodId: null,
      });
      const withExplicitDefault = deriveSubscriptionBaseKey({
        ...base,
        paymentMethodId: "default",
      });
      expect(withDefault).toBe(withExplicitDefault);
    });

    it("makes resubscribe-after-cancel DISTINCT from a retry of an in-flight attempt", () => {
      // Same intent but acting on an existing sub id vs a brand-new one →
      // different keys, so the new subscribe is NOT falsely deduped against
      // a prior attempt against the old sub.
      const onExisting = deriveSubscriptionBaseKey({
        ...base,
        existingExternalSubscriptionId: "sub_old",
      });
      const brandNew = deriveSubscriptionBaseKey({
        ...base,
        existingExternalSubscriptionId: null,
      });
      expect(onExisting).not.toBe(brandNew);
      // ...and two retries against the same existing sub DO match.
      expect(onExisting).toBe(
        deriveSubscriptionBaseKey({
          ...base,
          existingExternalSubscriptionId: "sub_old",
        }),
      );
    });

    it("caps an over-long client key at 200 chars", () => {
      const long = "k".repeat(500);
      expect(
        deriveSubscriptionBaseKey({ ...base, clientKey: long }).length,
      ).toBe(200);
    });
  });

  describe("deriveCancelBaseKey", () => {
    const base = {
      userId: "user-1",
      localSubscriptionId: "us_1",
      cancelImmediately: false,
    };

    it("uses a provided client key", () => {
      expect(deriveCancelBaseKey({ ...base, clientKey: "ck" })).toBe("ck");
    });

    it("is deterministic per (sub, mode) and distinct across mode", () => {
      const periodEnd = deriveCancelBaseKey(base);
      expect(deriveCancelBaseKey({ ...base })).toBe(periodEnd);
      expect(
        deriveCancelBaseKey({ ...base, cancelImmediately: true }),
      ).not.toBe(periodEnd);
    });

    it("is distinct across subscription id", () => {
      expect(
        deriveCancelBaseKey({ ...base, localSubscriptionId: "us_2" }),
      ).not.toBe(deriveCancelBaseKey(base));
    });
  });

  describe("opKey", () => {
    it("namespaces a base key per operation", () => {
      expect(opKey("base", "sub-create")).toBe("base:sub-create");
      expect(opKey("base", "customer")).toBe("base:customer");
    });

    it("produces distinct keys per op for the same base", () => {
      const base = "b";
      const keys = new Set([
        opKey(base, "customer"),
        opKey(base, "cust-update"),
        opKey(base, "pm-attach"),
        opKey(base, "sub-create"),
        opKey(base, "sub-update"),
        opKey(base, "sub-cancel"),
      ]);
      expect(keys.size).toBe(6);
    });

    it("caps the namespaced key at 200 chars", () => {
      expect(opKey("x".repeat(300), "sub-create").length).toBe(200);
    });
  });
});
