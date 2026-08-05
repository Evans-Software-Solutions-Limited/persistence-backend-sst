import {
  annualSaving,
  catalogTier,
  ctaFor,
  SUBSCRIPTION_CATALOG,
} from "./index";
import { describe, expect, it } from "vitest";

describe("subscription catalog", () => {
  it("keeps all IAP paid calls to action disabled before App Store launch", () => {
    for (const tier of SUBSCRIPTION_CATALOG.filter(
      (candidate) => candidate.rail === "iap" && candidate.monthly !== 0,
    )) {
      expect(ctaFor(tier)).toEqual({
        label: "Coming soon",
        enabled: false,
        kind: "soon",
      });
    }
  });

  it("derives each annual saving from that tier's catalog values", () => {
    expect(annualSaving(catalogTier("premium"))).toBe(31);
    expect(annualSaving(catalogTier("individual_trainer"))).toBe(30);
    expect(annualSaving(catalogTier("coach_pro"))).toBe(30);
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
