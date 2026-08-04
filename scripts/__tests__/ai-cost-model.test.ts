import { describe, it, expect } from "vitest";
import {
  AI_ENDPOINTS,
  APPLE_COMMISSION,
  STANDARD_APPLE_COMMISSION,
  WEB_RAIL_COMMISSION,
  tierCost,
  MARGINAL_INFRA_USD_PER_USER,
  TIERS,
  bindingCeiling,
  costPerCall,
  endpointsForTier,
  fixedMonthlyTotalUsd,
  infraPerUserUsd,
  report,
  tierCost,
  type Tier,
} from "../ai-cost-model";

function tier(name: string): Tier {
  const found = TIERS.find((t) => t.name === name);
  if (!found) throw new Error(`no such tier: ${name}`);
  return found;
}

function endpoint(key: string) {
  const found = AI_ENDPOINTS.find((e) => e.key === key);
  if (!found) throw new Error(`no such endpoint: ${key}`);
  return found;
}

describe("costPerCall", () => {
  it("prices input and output separately at the model's rate", () => {
    // 1M in + 1M out on Haiku ($1/$5) = $6.
    expect(
      costPerCall({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        model: "haiku",
        measured: false,
        basis: "test",
      }),
    ).toBeCloseTo(6, 6);
  });

  it("charges Opus 5× the input and 5× the output of Haiku", () => {
    const shape = { inputTokens: 1_000, outputTokens: 1_000, basis: "test" };
    const haiku = costPerCall({ ...shape, model: "haiku", measured: false });
    const opus = costPerCall({ ...shape, model: "opus", measured: false });
    expect(opus / haiku).toBeCloseTo(5, 6);
  });

  it("reproduces the two MEASURED unit costs from Phase E", () => {
    // These are the only figures in the model with real Bedrock runs behind them,
    // so the token profiles must back-derive to them. If either drifts, the whole
    // table's credibility goes with it.
    expect(costPerCall(endpoint("loadout_remap").profile)).toBeCloseTo(
      0.0057,
      4,
    );
    expect(costPerCall(endpoint("equipment_scan").profile)).toBeCloseTo(
      0.0272,
      4,
    );
  });

  it("keeps the scan ~4.8× the re-map, the ratio the ceiling decision rested on", () => {
    const scan = costPerCall(endpoint("equipment_scan").profile);
    const remap = costPerCall(endpoint("loadout_remap").profile);
    expect(scan / remap).toBeGreaterThan(4);
    expect(scan / remap).toBeLessThan(6);
  });
});

describe("endpointsForTier", () => {
  it("gives Free nothing", () => {
    expect(endpointsForTier(tier("free"))).toHaveLength(0);
  });

  it("gives Premium the ai_access endpoints but NOT Loadout", () => {
    const keys = endpointsForTier(tier("premium")).map((e) => e.key);
    expect(keys).toContain("nutrition_photo");
    expect(keys).not.toContain("loadout_remap");
    expect(keys).not.toContain("equipment_scan");
  });

  it("gives Premium+ both gates", () => {
    const keys = endpointsForTier(tier("premium_plus")).map((e) => e.key);
    expect(keys).toContain("nutrition_photo");
    expect(keys).toContain("equipment_scan");
  });

  it("gives every trainer tier Loadout too", () => {
    // `20260725194527_premium_plus_tier` grants `loadout_access` to all three
    // trainer tiers, which is what makes Individual Trainer the most exposed tier.
    for (const name of [
      "individual_trainer",
      "small_business",
      "medium_enterprise",
    ]) {
      expect(endpointsForTier(tier(name)).map((e) => e.key)).toContain(
        "loadout_remap",
      );
    }
  });
});

describe("bindingCeiling", () => {
  it("returns the env ceiling for an ordinary endpoint", () => {
    expect(bindingCeiling(tier("premium"), endpoint("nutrition_photo"))).toBe(
      12,
    );
  });

  it("returns ZERO for the coach summary on an athlete tier", () => {
    // The route needs a trainer↔client relationship, so a Premium athlete cannot
    // call it. Charging them 40/day for it overstated Premium by $7.20/mo — a
    // third of that tier's whole worst case.
    expect(bindingCeiling(tier("premium"), endpoint("coach_summary"))).toBe(0);
    expect(
      bindingCeiling(tier("premium_plus"), endpoint("coach_summary")),
    ).toBe(0);
  });

  it("lets the ROSTER bind below the env ceiling on a 2-client tier", () => {
    // min(40, 2 × 2) = 4. Using 40 here would overstate the thinnest-margin tier
    // by ~10×, i.e. the error would land exactly where it matters most.
    expect(
      bindingCeiling(tier("individual_trainer"), endpoint("coach_summary")),
    ).toBe(4);
  });

  it("lets the env ceiling bind once the roster is large enough", () => {
    // min(40, 2 × 30) = 40.
    expect(
      bindingCeiling(tier("small_business"), endpoint("coach_summary")),
    ).toBe(40);
    expect(
      bindingCeiling(tier("medium_enterprise"), endpoint("coach_summary")),
    ).toBe(40);
  });
});

describe("tierCost", () => {
  it("nets Apple's cut and RevenueCat's off gross revenue", () => {
    const cost = tierCost(tier("premium"));
    // £12.99 × 1.27 × 0.85 × 0.99
    expect(cost.netRevenueUsd).toBeCloseTo(12.99 * 1.27 * 0.85 * 0.99, 4);
  });

  it("gives Free zero revenue, zero cost and no endpoints", () => {
    const cost = tierCost(tier("free"));
    expect(cost.netRevenueUsd).toBe(0);
    expect(cost.worstCaseAiUsd).toBe(0);
    expect(cost.perEndpoint).toHaveLength(0);
    // Guards the divide-by-zero path in the share calculation.
    expect(cost.worstCaseEstimatedShare).toBe(0);
  });

  it("OMITS an unreachable endpoint from the breakdown rather than listing it at $0", () => {
    // A row of zeroes reads as "free", not "unreachable".
    const labels = tierCost(tier("premium")).perEndpoint.map((e) => e.label);
    expect(labels).not.toContain(endpoint("coach_summary").label);
  });

  it("finds Individual Trainer the MOST exposed tier as a share of net revenue", () => {
    // The headline finding: a coach gets `loadout_access` at £14.99 while an
    // athlete pays £29.99 for it. If a pricing change ever fixes that, this test
    // should fail and be updated deliberately.
    const shares = TIERS.filter((t) => t.priceMonthly > 0).map((t) => {
      const cost = tierCost(t);
      return { name: t.name, share: cost.worstCaseAiUsd / cost.netRevenueUsd };
    });
    const worst = shares.reduce((a, b) => (b.share > a.share ? b : a));
    expect(worst.name).toBe("individual_trainer");
    expect(worst.share).toBeGreaterThan(1);
  });

  it("finds three tiers theoretically underwater at their ceilings", () => {
    const underwater = TIERS.filter((t) => t.priceMonthly > 0)
      .map((t) => ({ t, cost: tierCost(t) }))
      .filter(({ cost }) => cost.worstCaseAiUsd > cost.netRevenueUsd)
      .map(({ t }) => t.name);

    expect(underwater).toEqual([
      "premium",
      "premium_plus",
      "individual_trainer",
    ]);
  });

  it("keeps TYPICAL use comfortably profitable on every paid tier", () => {
    // The other half of the finding, and the reason none of this is an emergency.
    for (const t of TIERS.filter((x) => x.priceMonthly > 0)) {
      const cost = tierCost(t);
      expect(cost.typicalAiUsd / cost.netRevenueUsd).toBeLessThan(0.2);
    }
  });

  it("caps typical use by what binds, not just by the typical rate", () => {
    // A 2-client coach cannot make more summaries per day than they have clients.
    const individual = tierCost(tier("individual_trainer"));
    const small = tierCost(tier("small_business"));
    expect(individual.typicalAiUsd).toBeLessThanOrEqual(small.typicalAiUsd);
  });

  it("reports Premium's worst case as ENTIRELY estimated", () => {
    // Premium cannot reach either measured endpoint, so every number in its row
    // rests on a token guess. That is the caveat that must not get lost.
    expect(tierCost(tier("premium")).worstCaseEstimatedShare).toBe(1);
  });

  it("reports Premium+ as part-measured", () => {
    const share = tierCost(tier("premium_plus")).worstCaseEstimatedShare;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });

  it("attributes most of Premium's exposure to recipe extraction, not Loadout", () => {
    // The conclusion that matters for what to fix next.
    const rows = [...tierCost(tier("premium")).perEndpoint].sort(
      (a, b) => b.worstCaseUsd - a.worstCaseUsd,
    );
    expect(rows[0].label).toBe(endpoint("recipe_extract").label);
  });

  it("puts Loadout's two surfaces at roughly cost parity", () => {
    const rows = tierCost(tier("premium_plus")).perEndpoint;
    const remap = rows.find((r) => r.label === endpoint("loadout_remap").label);
    const scan = rows.find((r) => r.label === endpoint("equipment_scan").label);
    // The whole argument for 6/day rather than 10: the scan lands next to the
    // re-map's $5.13 instead of at $8.16.
    expect(remap?.worstCaseUsd).toBeCloseTo(5.13, 1);
    expect(scan?.worstCaseUsd).toBeCloseTo(4.9, 1);
  });
});

describe("infrastructure", () => {
  it("sums the fixed line items", () => {
    expect(fixedMonthlyTotalUsd()).toBeGreaterThan(0);
  });

  it("amortises fixed cost across subscribers and adds the marginal slice", () => {
    expect(infraPerUserUsd(1_000)).toBeCloseTo(
      fixedMonthlyTotalUsd() / 1_000 + MARGINAL_INFRA_USD_PER_USER,
      6,
    );
  });

  it("falls with scale and converges on the marginal cost", () => {
    expect(infraPerUserUsd(100)).toBeGreaterThan(infraPerUserUsd(1_000));
    expect(infraPerUserUsd(1_000_000)).toBeCloseTo(
      MARGINAL_INFRA_USD_PER_USER,
      3,
    );
  });

  it("is negligible against AI cost at any real scale", () => {
    // The useful finding: serving requests is not what this platform costs.
    expect(infraPerUserUsd(1_000)).toBeLessThan(1);
  });

  it("returns Infinity for zero subscribers rather than dividing by zero", () => {
    expect(infraPerUserUsd(0)).toBe(Number.POSITIVE_INFINITY);
    expect(infraPerUserUsd(-5)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("report", () => {
  it("renders every tier and both infra scale points", () => {
    const out = report();
    for (const t of TIERS) expect(out).toContain(t.label);
    expect(out).toContain("subscribers →");
  });

  it("labels Premium+ as unlaunched", () => {
    // It is seeded `is_active = false`; a reader must not treat its row as live
    // revenue.
    expect(report()).toContain("Premium+ (unlaunched)");
  });

  it("states the measured/estimated caveat up front, with counts that cannot go stale", () => {
    // ⚠ Derived, not pinned to prose. The previous version asserted "only the two
    // loadout unit costs are measured" and went stale the moment Mealprint became
    // the ninth endpoint — the same failure mode that moved these figures out of
    // STATE.md and into this script in the first place.
    const measured = AI_ENDPOINTS.filter((e) => e.profile.measured).length;
    const derived = AI_ENDPOINTS.length - measured;
    expect(report()).toContain(
      `Only ${measured} of ${AI_ENDPOINTS.length} unit costs are MEASURED`,
    );
    expect(report()).toContain(`the other ${derived} are derived`);
  });

  it("⚠ models the post-$1M commission reversion, because growth triggers it", () => {
    // Crossing $1M/yr removes Small Business Program eligibility and Apple goes
    // 15% -> 30%. The web rail does not move — that asymmetry is the argument for
    // the split rail, and it WIDENS as the business succeeds.
    const premium = TIERS.find((t) => t.name === "premium")!;
    const now = tierCost(premium).netRevenueUsd;
    const past = tierCost(premium, STANDARD_APPLE_COMMISSION).netRevenueUsd;
    const web = tierCost(premium, WEB_RAIL_COMMISSION).netRevenueUsd;

    expect(past).toBeLessThan(now);
    expect(web).toBeGreaterThan(now);
    // ~18% less net revenue on the same sticker price.
    expect(past / now).toBeCloseTo(0.82, 2);
    // The web rail's advantage over IAP roughly doubles past the threshold.
    expect(web - past).toBeGreaterThan((web - now) * 1.9);
    expect(report()).toContain("Commission scenarios");
  });

  it("⚠ reaches Mealprint from premium_plus ONLY — the asymmetry with Loadout is the open pricing question", () => {
    // `mealprint_access` is granted by migration 20260803120200 to premium_plus
    // alone, while `loadout_access` also reaches all three trainer tiers. Modelling
    // them as one flag would hide the number needed to settle that question, so
    // this pins the two sets apart.
    const reaches = (tierName: string, key: string) =>
      endpointsForTier(TIERS.find((t) => t.name === tierName)!).some(
        (e) => e.key === key,
      );

    expect(reaches("premium_plus", "meal_suggest")).toBe(true);
    for (const tier of [
      "free",
      "premium",
      "individual_trainer",
      "small_business",
      "medium_enterprise",
    ]) {
      expect(reaches(tier, "meal_suggest")).toBe(false);
    }
    // …and the contrast that makes it a question at all: a £14.99 coach tier does
    // reach Loadout, which an athlete pays £29.99 for.
    expect(reaches("individual_trainer", "loadout_remap")).toBe(true);
  });

  it("marks the measured rows in the breakdown", () => {
    expect(report()).toContain("(measured)");
  });

  it("renders an em dash rather than NaN% for Free's share of zero revenue", () => {
    const freeLine = report()
      .split("\n")
      .find((line) => line.startsWith("Free"));
    expect(freeLine).toBeDefined();
    expect(freeLine).not.toContain("NaN");
  });

  it("shows the Apple commission it assumed", () => {
    // Every ratio in the table moves with this, so it must be on the page.
    expect(report()).toContain(`Apple ${(APPLE_COMMISSION * 100).toFixed(0)}%`);
  });
});
