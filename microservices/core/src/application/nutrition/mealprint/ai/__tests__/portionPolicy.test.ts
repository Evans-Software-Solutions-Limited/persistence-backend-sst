import { describe, expect, it } from "vitest";
import type { MealprintCandidate } from "../../../../repositories/mealprintCandidateRepository";
import {
  assessCompositionPortion,
  maxCheatMealKcal,
  maxMealKcal,
} from "../portionPolicy";

function food(id: string, kcal: number, maxServings = 2): MealprintCandidate {
  return {
    kind: "food",
    id,
    name: id,
    kcal,
    proteinG: 1,
    carbsG: 1,
    fatG: 1,
    servingLabel: "100 g",
    servingBasis: "declared",
    maxServings,
    allergenTags: [],
    categoryTags: [],
    isOwn: false,
  };
}

describe("Mealprint portion policy", () => {
  it("allocates a one-plate ceiling from the daily target and meal count", () => {
    expect(maxMealKcal({ dailyKcal: 1_800, mealsPerDay: 4 })).toBe(607.5);
    expect(
      maxMealKcal({ dailyKcal: 1_800, mealsPerDay: 4, shape: "snack" }),
    ).toBe(337.5);
    expect(maxCheatMealKcal({ dailyKcal: 1_800, mealsPerDay: 4 })).toBe(1_350);
  });

  it("rejects the reported lentil/rice/curry plate as one-person implausible", () => {
    const candidates = new Map(
      [
        food("lentils", 203.3),
        food("rice", 357.1),
        food("tomatoes", 18),
        food("onion", 40),
        food("curry", 291.7),
      ].map((candidate) => [candidate.id, candidate]),
    );
    const failure = assessCompositionPortion({
      candidates,
      kcalCeiling: maxMealKcal({ dailyKcal: 1_800, mealsPerDay: 4 }),
      items: [
        { candidateId: "lentils", servings: 2 },
        { candidateId: "rice", servings: 1.5 },
        { candidateId: "tomatoes", servings: 0.5 },
        { candidateId: "onion", servings: 0.3 },
        { candidateId: "curry", servings: 0.25 },
      ],
    });
    expect(failure).toMatchObject({ kind: "meal" });
    expect(failure?.detail).toBe("kcal=1036>608");
  });

  it("rejects an item above its candidate-specific maximum", () => {
    const candidate = food("yogurt", 100);
    expect(
      assessCompositionPortion({
        candidates: new Map([[candidate.id, candidate]]),
        kcalCeiling: 1_000,
        items: [{ candidateId: candidate.id, servings: 2.25 }],
      }),
    ).toEqual({ kind: "item", detail: "yogurt:servings=2.25>2" });
  });

  it("aggregates duplicate candidate ids before enforcing the item maximum", () => {
    const candidate = food("yogurt", 100);
    expect(
      assessCompositionPortion({
        candidates: new Map([[candidate.id, candidate]]),
        kcalCeiling: 1_000,
        items: [
          { candidateId: candidate.id, servings: 1.25 },
          { candidateId: candidate.id, servings: 1 },
        ],
      }),
    ).toEqual({ kind: "item", detail: "yogurt:servings=2.25>2" });
  });
});
