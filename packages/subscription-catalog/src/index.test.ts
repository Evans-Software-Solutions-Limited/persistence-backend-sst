import {
  GRANTABLE_TIERS,
  isGrantableTier,
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

  // PER-103: Premium carries no AI, Premium+ carries all of it. A Premium line
  // that promised AI would sell a feature the server refuses with a 402.
  it("advertises no AI on Free or Premium", () => {
    for (const id of ["free", "premium"] as const) {
      const features = catalogTier(id).features.join(" ");
      expect(features, id).not.toMatch(/\bAI\b|Smart swap|Mealprint|Loadout/i);
    }
  });

  it("puts AI food logging on Premium+", () => {
    const tier = catalogTier("premium_plus");
    expect(tier.features.join(" ")).toMatch(/AI food logging/);
    expect(tier.tagline).toMatch(/AI/);
  });

  // Structured recipe import (a page's recipe metadata) is open on every tier;
  // only the AI step is Premium+, so the line must say AI, not plain import.
  it("sells the AI recipe import on Premium+, never plain recipe import", () => {
    const features = catalogTier("premium_plus").features;
    expect(features).toContain("AI smart recipe import and recipe estimates");
    expect(features.some((line) => /^Recipe import/i.test(line))).toBe(false);
  });

  // Not built yet: no route, job kind or screen exists for it.
  it("does not advertise programme import", () => {
    const all = SUBSCRIPTION_CATALOG.flatMap((tier) => tier.features).join(" ");
    expect(all).not.toMatch(/Programme import/i);
  });

  it("keeps organisation tiers web-only", () => {
    expect(
      SUBSCRIPTION_CATALOG.filter((tier) => tier.audience === "org").every(
        (tier) => tier.rail === "web",
      ),
    ).toBe(true);
  });
});

it("limits grants to supported paid app catalogue tiers, excluding marketing-only plans", () => {
  expect(GRANTABLE_TIERS.map((t) => t.id)).toEqual([
    "premium",
    "premium_plus",
    "individual_trainer",
    "start_up_coach_plus",
    "coach",
    "coach_pro",
  ]);
  for (const tier of SUBSCRIPTION_CATALOG)
    expect(isGrantableTier(tier.id)).toBe(
      tier.id !== "free" && tier.rail === "iap",
    );
  expect(isGrantableTier("retired_tier")).toBe(false);
});
