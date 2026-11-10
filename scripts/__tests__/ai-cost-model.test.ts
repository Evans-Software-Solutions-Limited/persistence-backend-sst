import { describe, it, expect } from "vitest";
import {
  AI_ENDPOINTS,
  APPLE_COMMISSION,
  SMALL_BUSINESS_APPLE_COMMISSION,
  WEB_RAIL_COMMISSION,
  REVENUECAT_RATE,
  IAP_VAT_RATE,
  WEB_RAIL_VAT_RATE,
  MARGINAL_INFRA_USD_PER_USER,
  TIERS,
  BUDGET_CAP_SHARE,
  annualNetMonthlyUsd,
  bindingCeiling,
  budgetCeilingUsd,
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

  it("gives Premium nothing: it carries no AI since PER-103", () => {
    expect(endpointsForTier(tier("premium"))).toHaveLength(0);
  });

  it("gives Premium+ every athlete AI endpoint", () => {
    const keys = endpointsForTier(tier("premium_plus")).map((e) => e.key);
    expect(keys).toContain("nutrition_photo");
    expect(keys).toContain("equipment_scan");
    expect(keys).toContain("meal_suggest");
  });

  it("gives Start Up Coach AI but not the suite, and every other coach rung the suite", () => {
    const entry = endpointsForTier(tier("individual_trainer")).map(
      (e) => e.key,
    );
    expect(entry).toContain("nutrition_photo");
    expect(entry).not.toContain("loadout_remap");
    expect(entry).not.toContain("meal_suggest");
    for (const name of ["start_up_coach_plus", "coach", "coach_pro"]) {
      const keys = endpointsForTier(tier(name)).map((e) => e.key);
      expect(keys, name).toContain("loadout_remap");
      expect(keys, name).toContain("meal_suggest");
    }
  });
});

describe("bindingCeiling", () => {
  it("returns the env ceiling for an ordinary endpoint", () => {
    expect(
      bindingCeiling(tier("premium_plus"), endpoint("nutrition_photo")),
    ).toBe(12);
  });

  it("returns ZERO for the coach summary on an athlete tier", () => {
    // The route needs a trainer↔client relationship, so an athlete cannot call
    // it. Charging them 40/day for it would overstate their worst case by $7.20.
    expect(
      bindingCeiling(tier("premium_plus"), endpoint("coach_summary")),
    ).toBe(0);
  });

  it("lets the ROSTER bind below the env ceiling on a 5-client tier", () => {
    // min(40, 2 × 5) = 10.
    expect(
      bindingCeiling(tier("individual_trainer"), endpoint("coach_summary")),
    ).toBe(10);
  });

  it("lets the env ceiling bind once the roster is large enough", () => {
    // min(40, 2 × 30) = 40.
    expect(bindingCeiling(tier("coach_pro"), endpoint("coach_summary"))).toBe(
      40,
    );
  });
});

describe("tierCost", () => {
  it("nets VAT, Apple's cut and RevenueCat's off gross revenue", () => {
    const cost = tierCost(tier("premium_plus"));
    // £24.99 ÷ (1 + VAT) × 1.27 × (1 − Apple) × (1 − RevenueCat). ⚠ Derived from the
    // constants rather than hardcoding 0.85 — that literal was the unapproved Small
    // Business rate, and pinning it made the default change a test failure instead
    // of a recomputation.
    expect(cost.netRevenueUsd).toBeCloseTo(
      ((24.99 * 1.27) / (1 + IAP_VAT_RATE)) *
        (1 - APPLE_COMMISSION) *
        (1 - REVENUECAT_RATE),
      4,
    );
  });

  it("⚠ takes VAT off BEFORE commission, not after", () => {
    // The two orderings differ by ~$0.6/mo on one tier alone and compound across the
    // ladder. Apple is the merchant of record: it remits the VAT and its commission
    // is a share of the VAT-EXCLUSIVE price. Commission-first would overstate net.
    const cost = tierCost(tier("premium_plus")).netRevenueUsd;
    const gross = 24.99 * 1.27;
    const vatFirst =
      (gross / (1 + IAP_VAT_RATE)) *
      (1 - APPLE_COMMISSION) *
      (1 - REVENUECAT_RATE);
    const commissionFirst =
      (gross * (1 - APPLE_COMMISSION) * (1 - REVENUECAT_RATE)) /
      (1 + IAP_VAT_RATE);
    // Multiplication commutes, so these two happen to agree — the assertion that
    // matters is that VAT is applied AT ALL, which the pre-2026-08-04 model did not
    // do and which is a ~17 % error in the optimistic direction.
    expect(cost).toBeCloseTo(vatFirst, 6);
    expect(cost).toBeCloseTo(commissionFirst, 6);
    expect(cost).toBeLessThan(
      gross * (1 - APPLE_COMMISSION) * (1 - REVENUECAT_RATE),
    );
    expect(cost).toBeCloseTo(
      gross * (1 - APPLE_COMMISSION) * (1 - REVENUECAT_RATE) * (1 / 1.2),
      6,
    );
  });

  it("⚠ charges NO VAT on the web rail, where we are the merchant of record", () => {
    // Below the registration threshold the full price is ours. Passing the web
    // commission WITHOUT this override was the trap: it would understate the split
    // rail by 17 % and hide most of its advantage over IAP.
    const web = tierCost(
      tier("premium_plus"),
      WEB_RAIL_COMMISSION,
      WEB_RAIL_VAT_RATE,
    ).netRevenueUsd;
    expect(web).toBeCloseTo(
      24.99 * 1.27 * (1 - WEB_RAIL_COMMISSION) * (1 - REVENUECAT_RATE),
      4,
    );
    // And it must beat the IAP rail by MORE than the commission spread alone.
    const iap = tierCost(tier("premium_plus")).netRevenueUsd;
    const commissionSpreadOnly =
      24.99 * 1.27 * (1 - WEB_RAIL_COMMISSION) * (1 - REVENUECAT_RATE) -
      24.99 * 1.27 * (1 - APPLE_COMMISSION) * (1 - REVENUECAT_RATE);
    expect(web - iap).toBeGreaterThan(commissionSpreadOnly);
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
    const labels = tierCost(tier("premium_plus")).perEndpoint.map(
      (e) => e.label,
    );
    expect(labels).not.toContain(endpoint("coach_summary").label);
  });

  it("finds Premium+ the MOST exposed tier as a share of net revenue", () => {
    // Every athlete AI endpoint at £24.99: the worst case (all caps hit every
    // day) is ~2.4× its net, which is what the $4.89 budget bounds. If a
    // pricing change moves this, update it deliberately.
    const shares = TIERS.filter((t) => t.aiAccess).map((t) => {
      const cost = tierCost(t);
      return { name: t.name, share: cost.worstCaseAiUsd / cost.netRevenueUsd };
    });
    const worst = shares.reduce((a, b) => (b.share > a.share ? b : a));
    expect(worst.name).toBe("premium_plus");
    expect(worst.share).toBeGreaterThan(1);
  });

  it("finds every AI tier below Coach Pro theoretically underwater at its ceilings", () => {
    // Why the per-user AI budget exists: per-feature daily caps alone do not
    // bound total spend.
    const underwater = TIERS.filter((t) => t.priceMonthly > 0)
      .map((t) => ({ t, cost: tierCost(t) }))
      .filter(({ cost }) => cost.worstCaseAiUsd > cost.netRevenueUsd)
      .map(({ t }) => t.name);

    expect(underwater).toEqual([
      "premium_plus",
      "individual_trainer",
      "start_up_coach_plus",
      "coach",
    ]);
  });

  it("keeps TYPICAL use comfortably profitable on every paid tier", () => {
    for (const t of TIERS.filter((x) => x.priceMonthly > 0)) {
      const cost = tierCost(t);
      expect(cost.typicalAiUsd / cost.netRevenueUsd).toBeLessThan(0.2);
    }
  });

  it("caps typical use by what binds, not just by the typical rate", () => {
    // A 5-client coach cannot make more summaries per day than they have clients.
    const entry = tierCost(tier("start_up_coach_plus"));
    const pro = tierCost(tier("coach_pro"));
    expect(entry.typicalAiUsd).toBeLessThanOrEqual(pro.typicalAiUsd);
  });

  it("costs Premium nothing in AI: no endpoint, no worst case, no typical", () => {
    const cost = tierCost(tier("premium"));
    expect(cost.perEndpoint).toHaveLength(0);
    expect(cost.worstCaseAiUsd).toBe(0);
    expect(cost.typicalAiUsd).toBe(0);
  });

  it("reports Premium+ as part-measured", () => {
    const share = tierCost(tier("premium_plus")).worstCaseEstimatedShare;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });

  it("attributes most of Premium+'s exposure to recipe extraction, not Loadout", () => {
    const rows = [...tierCost(tier("premium_plus")).perEndpoint].sort(
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

  it("labels no tier unlaunched now that the whole IAP ladder is live", () => {
    expect(report()).not.toContain("(unlaunched)");
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

  it("⚠ DEFAULTS to Apple's standard 30%, not the unapproved Small Business rate", () => {
    // Brad 2026-08-04: the Small Business application is NOT approved, and even once
    // granted it lapses above $1M/yr. Pricing against a discount we do not hold is
    // how a tier ships underwater, so the default is the rate we can always be sure
    // of and the discount is upside.
    expect(APPLE_COMMISSION).toBe(0.3);
    expect(SMALL_BUSINESS_APPLE_COMMISSION).toBe(0.15);

    const premium = TIERS.find((t) => t.name === "premium_plus")!;
    const assumed = tierCost(premium).netRevenueUsd;
    const ifApproved = tierCost(
      premium,
      SMALL_BUSINESS_APPLE_COMMISSION,
    ).netRevenueUsd;
    const web = tierCost(premium, WEB_RAIL_COMMISSION).netRevenueUsd;

    // The discount is upside, never a dependency.
    expect(ifApproved).toBeGreaterThan(assumed);
    // The web rail beats BOTH, and beats the assumed rate by the wider margin —
    // which is the argument for the split rail at 30%.
    expect(web).toBeGreaterThan(ifApproved);
    expect(web - assumed).toBeGreaterThan(web - ifApproved);
    expect(report()).toContain("Commission scenarios");
  });

  it("reaches Loadout and Mealprint on exactly the suite tiers", () => {
    // Spec-29 Phase 2 granted Mealprint to every suite-bearing coach rung, so
    // the two flags now cover the same set; Start Up Coach has neither.
    const reaches = (tierName: string, key: string) =>
      endpointsForTier(TIERS.find((t) => t.name === tierName)!).some(
        (e) => e.key === key,
      );
    const suite = ["premium_plus", "start_up_coach_plus", "coach", "coach_pro"];
    for (const t of TIERS) {
      const expected = suite.includes(t.name);
      expect(reaches(t.name, "meal_suggest"), t.name).toBe(expected);
      expect(reaches(t.name, "loadout_remap"), t.name).toBe(expected);
    }
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

describe("AI budget ceiling (PER-103)", () => {
  it("nets the annual plan per month from the yearly price", () => {
    expect(annualNetMonthlyUsd(tier("premium_plus"))).toBeCloseTo(
      ((199.99 / 12) * 1.27 * (1 - APPLE_COMMISSION) * (1 - REVENUECAT_RATE)) /
        (1 + IAP_VAT_RATE),
      6,
    );
    expect(annualNetMonthlyUsd(tier("free"))).toBeNull();
  });

  it("sizes the ceiling on the annual plan, which nets less than monthly", () => {
    const t = tier("premium_plus");
    expect(annualNetMonthlyUsd(t)!).toBeLessThan(tierCost(t).netRevenueUsd);
    expect(budgetCeilingUsd(t)).toBeCloseTo(
      BUDGET_CAP_SHARE * annualNetMonthlyUsd(t)!,
      6,
    );
  });

  it("reproduces Premium+'s $4.89 budget in 20261106120000_premium_without_ai.sql", () => {
    expect(budgetCeilingUsd(tier("premium_plus"))).toBeCloseTo(4.89, 2);
  });

  it("keeps Premium+'s typical AI use inside its budget", () => {
    const t = tier("premium_plus");
    expect(tierCost(t).typicalAiUsd).toBeLessThan(budgetCeilingUsd(t));
  });

  it("prints the ceiling for every AI tier", () => {
    const out = report();
    expect(out).toContain("AI budget ceiling");
    expect(out).toContain("$4.89");
  });
});
