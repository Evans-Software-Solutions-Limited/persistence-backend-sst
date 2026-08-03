/**
 * Mealprint (spec-26 design § 1 stage 3) — `verifyComposition` tests.
 *
 * This is the stage that makes the design's central claim true: every number the
 * user sees is recomputed from a DB row, and allergen safety is enforced a SECOND
 * time over what the model actually composed. So the tests are written adversarially
 * — each one asks "what would reach the user if this check were absent?"
 */

import { describe, it, expect } from "vitest";
import {
  KCAL_OVERSHOOT_TOLERANCE,
  MIN_USEFUL_REMAINING_KCAL,
  describeVerification,
  verifySuggestions,
} from "../verifyComposition";
import type { MealprintCandidate } from "../../../../repositories/mealprintCandidateRepository";
import type { ModelSuggestion } from "../suggestModel";

function candidate(over: Partial<MealprintCandidate> = {}): MealprintCandidate {
  return {
    kind: "food",
    id: "yog",
    name: "Greek Yogurt",
    kcal: 100,
    proteinG: 10,
    carbsG: 4,
    fatG: 1,
    servingLabel: "170 g",
    allergenTags: [],
    categoryTags: [],
    isOwn: false,
    ...over,
  };
}

const NO_PREFS = {
  dietaryPatterns: [] as string[],
  avoidAllergens: [] as string[],
  avoidFoods: [] as string[],
};

const REMAINING = { kcal: 620, proteinG: 42, carbsG: 60, fatG: 20 };

function suggestion(
  items: Array<{ candidateId: string; servings: number }>,
  name = "A suggestion",
): ModelSuggestion {
  return { name, reason: "because it fits", items };
}

describe("verifySuggestions — macros come from the DB, never the model", () => {
  it("recomputes every macro as row × servings", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "yog", servings: 2 }])],
      candidates: [candidate()],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });

    expect(result.suggestions).toHaveLength(1);
    const [verified] = result.suggestions;
    expect(verified.items[0].kcal).toBe(200);
    expect(verified.items[0].proteinG).toBe(20);
    expect(verified.kcal).toBe(200);
    expect(verified.proteinG).toBe(20);
  });

  it("sums a multi-item suggestion from the rows", () => {
    const result = verifySuggestions({
      suggestions: [
        suggestion([
          { candidateId: "yog", servings: 1 },
          { candidateId: "cake", servings: 3 },
        ]),
      ],
      candidates: [
        candidate(),
        candidate({ id: "cake", name: "Rice Cakes", kcal: 50, proteinG: 1 }),
      ],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(result.suggestions[0].kcal).toBe(250);
    expect(result.suggestions[0].proteinG).toBe(13);
  });

  it("carries the servings through so the client can render the amount", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "yog", servings: 1.5 }])],
      candidates: [candidate()],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(result.suggestions[0].items[0].servings).toBe(1.5);
    expect(result.suggestions[0].items[0].servingLabel).toBe("170 g");
  });
});

describe("verifySuggestions — avoidance re-runs (defence in depth)", () => {
  // ⚠ THE MOST IMPORTANT BLOCK IN THIS FILE. Stage 1 built the pool, but this is
  // the pass that holds if stage 1 was ever wrong — a stale preference read, a
  // wrong locale, a future caller that forgot to filter. Without it a bug in
  // candidate assembly reaches a peanut-avoiding user's plate.
  it("drops a suggestion whose item violates an allergen avoidance", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "pb", servings: 1 }])],
      // Deliberately handing the verifier an unsafe candidate — i.e. simulating a
      // stage-1 failure — and asserting it does not get through.
      candidates: [
        candidate({
          id: "pb",
          name: "Peanut Butter",
          allergenTags: ["en:peanuts"],
        }),
      ],
      remaining: REMAINING,
      preferences: { ...NO_PREFS, avoidAllergens: ["peanuts"] },
    });

    expect(result.suggestions).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].failure).toBe("avoidance_violation");
    expect(result.rejected[0].detail).toContain("peanuts");
  });

  it("drops the WHOLE suggestion, not just the offending item", () => {
    // Removing one item and keeping the rest would ship something the model did
    // not compose, whose reason line no longer describes it.
    const result = verifySuggestions({
      suggestions: [
        suggestion([
          { candidateId: "yog", servings: 1 },
          { candidateId: "pb", servings: 1 },
        ]),
      ],
      candidates: [
        candidate(),
        candidate({
          id: "pb",
          name: "Peanut Butter",
          allergenTags: ["en:peanuts"],
        }),
      ],
      remaining: REMAINING,
      preferences: { ...NO_PREFS, avoidAllergens: ["peanuts"] },
    });
    expect(result.suggestions).toEqual([]);
  });

  it("drops a suggestion violating a dietary pattern", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "chick", servings: 1 }])],
      candidates: [candidate({ id: "chick", name: "Chicken Breast" })],
      remaining: REMAINING,
      preferences: { ...NO_PREFS, dietaryPatterns: ["vegan"] },
    });
    expect(result.suggestions).toEqual([]);
    expect(result.rejected[0].detail).toContain("vegan");
  });

  it("keeps the other suggestions when one is dropped", () => {
    const result = verifySuggestions({
      suggestions: [
        suggestion([{ candidateId: "pb", servings: 1 }], "Unsafe"),
        suggestion([{ candidateId: "yog", servings: 1 }], "Safe"),
      ],
      candidates: [
        candidate(),
        candidate({
          id: "pb",
          name: "Peanut Butter",
          allergenTags: ["en:peanuts"],
        }),
      ],
      remaining: REMAINING,
      preferences: { ...NO_PREFS, avoidAllergens: ["peanuts"] },
    });
    expect(result.suggestions.map((s) => s.name)).toEqual(["Safe"]);
  });

  it("flags an unverified item so the caller renders the label-check disclaimer", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "rec", servings: 1 }])],
      candidates: [
        candidate({
          id: "rec",
          kind: "recipe",
          name: "My Chilli",
          allergenTags: null,
        }),
      ],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(result.suggestions[0].items[0].unverified).toBe(true);
    expect(result.suggestions[0].containsUnverified).toBe(true);
  });

  it("does not flag a suggestion whose items were all analysed", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "yog", servings: 1 }])],
      candidates: [candidate({ allergenTags: [] })],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(result.suggestions[0].containsUnverified).toBe(false);
  });

  it("reports partialEnforcementOnly for halal/kosher and not otherwise", () => {
    const base = {
      suggestions: [suggestion([{ candidateId: "yog", servings: 1 }])],
      candidates: [candidate()],
      remaining: REMAINING,
    };
    expect(
      verifySuggestions({
        ...base,
        preferences: { ...NO_PREFS, dietaryPatterns: ["halal"] },
      }).suggestions[0].partialEnforcementOnly,
    ).toBe(true);
    expect(
      verifySuggestions({
        ...base,
        preferences: { ...NO_PREFS, dietaryPatterns: ["vegan"] },
      }).suggestions[0].partialEnforcementOnly,
    ).toBe(false);
  });
});

describe("verifySuggestions — non-member ids", () => {
  it("drops a suggestion referencing an id absent from the candidate list", () => {
    // Defence in depth: `composeSuggestions` already throws on a non-member id.
    // This branch catches a CALLER that verified against the wrong list — a
    // mistake that would otherwise be invisible and unsafe.
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "ghost", servings: 1 }])],
      candidates: [candidate()],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(result.suggestions).toEqual([]);
    expect(result.rejected[0].failure).toBe("non_member_candidate");
    expect(result.rejected[0].detail).toBe("ghost");
  });
});

describe("verifySuggestions — tolerance", () => {
  it("accepts a suggestion inside the remaining calories", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "yog", servings: 5 }])],
      candidates: [candidate()],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(result.suggestions).toHaveLength(1);
  });

  it("accepts a small overshoot within tolerance", () => {
    const remaining = { ...REMAINING, kcal: 200 };
    const result = verifySuggestions({
      // 2.1 × 100 kcal = 210, i.e. 5 % over 200 exactly.
      suggestions: [suggestion([{ candidateId: "yog", servings: 2.1 }])],
      candidates: [candidate()],
      remaining,
      preferences: NO_PREFS,
    });
    expect(KCAL_OVERSHOOT_TOLERANCE).toBe(0.05);
    expect(result.suggestions).toHaveLength(1);
  });

  it("rejects an overshoot beyond tolerance", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "yog", servings: 5 }])],
      candidates: [candidate()],
      remaining: { ...REMAINING, kcal: 200 },
      preferences: NO_PREFS,
    });
    expect(result.suggestions).toEqual([]);
    expect(result.rejected[0].failure).toBe("kcal_overshoot");
    expect(result.rejected[0].detail).toBe("500>210");
  });

  it("is asymmetric — a big undershoot is fine", () => {
    // A smaller snack is a legitimate answer; there is no floor on how little of
    // the budget a suggestion may use.
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "yog", servings: 0.25 }])],
      candidates: [candidate()],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(result.suggestions).toHaveLength(1);
  });

  it("applies the absolute floor so a nearly-exhausted budget is not a tolerance artefact", () => {
    // ⚠ With 40 kcal left, 5 % is 2 kcal, so every real food would fail and the
    // user would see "no suggestions" for a reason that is arithmetic rather than
    // nutrition. The floor makes the check honest at the end of a day.
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "yog", servings: 1 }])],
      candidates: [candidate()],
      remaining: { ...REMAINING, kcal: 40 },
      preferences: NO_PREFS,
    });
    expect(MIN_USEFUL_REMAINING_KCAL).toBe(100);
    expect(result.suggestions).toHaveLength(1);
  });

  it("rejects a degenerate zero-macro composition", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "air", servings: 1 }])],
      candidates: [
        candidate({ id: "air", name: "Water", kcal: 0, proteinG: 0 }),
      ],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(result.suggestions).toEqual([]);
    expect(result.rejected[0].failure).toBe("degenerate_macros");
  });
});

describe("describeVerification", () => {
  it("counts the failures by cause", () => {
    const result = verifySuggestions({
      suggestions: [
        suggestion([{ candidateId: "ghost", servings: 1 }], "A"),
        suggestion([{ candidateId: "pb", servings: 1 }], "B"),
        suggestion([{ candidateId: "yog", servings: 1 }], "C"),
      ],
      candidates: [
        candidate(),
        candidate({
          id: "pb",
          name: "Peanut Butter",
          allergenTags: ["en:peanuts"],
        }),
      ],
      remaining: REMAINING,
      preferences: { ...NO_PREFS, avoidAllergens: ["peanuts"] },
    });
    const line = describeVerification(result);
    expect(line).toContain("verified=1");
    expect(line).toContain("non_member_candidate=1");
    // ⚠ `avoidance_violation` appearing at all means the two deterministic passes
    // DISAGREED, i.e. a bug in candidate assembly. Invisible without this line,
    // because the user just sees one fewer suggestion.
    expect(line).toContain("avoidance_violation=1");
  });

  it("says rejected=0 rather than printing nothing", () => {
    const result = verifySuggestions({
      suggestions: [suggestion([{ candidateId: "yog", servings: 1 }])],
      candidates: [candidate()],
      remaining: REMAINING,
      preferences: NO_PREFS,
    });
    expect(describeVerification(result)).toContain("rejected=0");
  });
});
