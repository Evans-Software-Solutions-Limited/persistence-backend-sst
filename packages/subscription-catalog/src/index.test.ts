import {
  annualSaving,
  catalogTier,
  ctaFor,
  SUBSCRIPTION_CATALOG,
} from "./index";
import { describe, expect, it } from "vitest";

describe("subscription catalog", () => {
  it("keeps IAP availability runtime-driven rather than build-configured", () => {
    for (const tier of SUBSCRIPTION_CATALOG.filter(
      (candidate) => candidate.rail === "iap" && candidate.id !== "free",
    )) {
      expect(tier.monthly).toBeNull();
      expect(tier.annual).toBeNull();
      expect(ctaFor(tier)).toEqual({
        label: "Coming soon",
        enabled: false,
        kind: "soon",
      });
      expect(ctaFor(tier, { iapAvailable: true })).toEqual({
        label: `Choose ${tier.name}`,
        enabled: true,
        kind: "iap",
      });
    }
  });

  it("derives annual savings from supplied live prices", () => {
    expect(annualSaving({ monthly: 16.99, annual: 139.99 })).toBe(31);
    expect(annualSaving({ monthly: 18.99, annual: 159.99 })).toBe(30);
    expect(annualSaving({ monthly: 34.99, annual: 289.99 })).toBe(31);
    expect(annualSaving({ monthly: 99.99, annual: 839.99 })).toBe(30);
    expect(
      annualSaving({
        monthly: 17.49,
        annual: 139.99,
        monthlySource: "store",
        annualSource: "api",
      }),
    ).toBeNull();
  });

  it("keeps Premium+ led by the real adaptive suite", () => {
    const features = catalogTier("premium_plus").features.join(" ");
    expect(features).toMatch(/Loadout/);
    expect(features).toMatch(/Mealprint/);
    expect(features).not.toMatch(/AI Workout Suggestions/i);
  });

  it("keeps organisation tiers web-only", () => {
    expect(
      SUBSCRIPTION_CATALOG.filter((tier) => tier.audience === "org").every(
        (tier) => tier.rail === "web",
      ),
    ).toBe(true);
  });
});
