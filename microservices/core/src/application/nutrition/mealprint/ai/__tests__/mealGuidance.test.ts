import { describe, it, expect } from "vitest";
import {
  parseMealGuidance,
  compositionMeetsGuidance,
  canMeetGuidance,
  guidanceSearchTerms,
} from "../mealGuidance";
import { assembleCandidates } from "../../candidates/assembleCandidates";
import { verifySuggestions } from "../verifyComposition";
import type { MealprintCandidate } from "../../../../repositories/mealprintCandidateRepository";

const food = (id: string, name: string, proteinG = 20): MealprintCandidate => ({
  id,
  name,
  kind: "food",
  kcal: 150,
  proteinG,
  carbsG: 5,
  fatG: 5,
  servingLabel: "1 portion",
  servingBasis: "declared",
  maxServings: 2,
  allergenTags: [],
  categoryTags: [],
  isOwn: false,
});
const chicken = food("chicken", "Chicken breast");
const prawns = food("prawns", "Grilled prawns", 30);
const tofu = food("tofu", "Tofu");
const preferences = { dietaryPatterns: [], avoidAllergens: [], avoidFoods: [] };
const meets = (steer: string, rows: MealprintCandidate[], servings = 1) =>
  compositionMeetsGuidance(
    rows.map((c) => ({ candidateId: c.id, servings })),
    new Map(rows.map((c) => [c.id, c])),
    parseMealGuidance(steer),
  );

describe("bounded meal guidance", () => {
  it("rejects reported prawn and mushroom dish for quick chicken request even with a chicken title", () => {
    const result = verifySuggestions({
      suggestions: [
        {
          name: "Quick chicken meal",
          reason: "quick",
          items: [{ candidateId: prawns.id, servings: 1 }],
          cheat: false,
          isOrder: false,
          tag: null,
        },
      ],
      candidates: [chicken, prawns],
      remaining: { kcal: 600, proteinG: 50, carbsG: 50, fatG: 20 },
      preferences,
      guidance: parseMealGuidance("something quick and chicken based"),
    });
    expect(result.suggestions).toEqual([]);
    expect(result.rejected[0].failure).toBe("guidance_violation");
    expect(meets("something quick and chicken based", [chicken])).toBe(true);
  });
  it.each([
    "Chicken stock",
    "Chicken flavour crisps",
    "Chicken-style vegan pieces",
    "Plant-based chicken",
    "Chicken-free pieces",
  ])("does not mistake %s for chicken", (name) => {
    expect(meets("chicken based", [food("x", name)])).toBe(false);
  });
  it("does not mistake a saved recipe title or a token chicken garnish for requested protein", () => {
    expect(meets("chicken", [{ ...chicken, kind: "recipe" }])).toBe(false);
    expect(meets("chicken", [chicken], 0.1)).toBe(false);
    expect(
      meets("chicken", [
        food("c", "Chicken breast", 5),
        food("p", "Prawns", 30),
      ]),
    ).toBe(false);
  });
  it.each([
    "no chicken",
    "without chicken",
    "don't want chicken",
    "anything but chicken",
    "chicken-free",
  ])("honours negative request %s", (steer) => {
    expect(meets(steer, [chicken])).toBe(false);
    expect(meets(steer, [tofu])).toBe(true);
    expect(parseMealGuidance(steer).required).toEqual([]);
  });
  it.each([
    "something not too spicy and chicken based",
    "not much time for cooking and chicken based",
    "no complicated cooking and chicken based",
  ])(
    "does not apply unrelated earlier negation to wanted chicken: %s",
    (steer) => {
      expect(parseMealGuidance(steer).required).toEqual([["chicken"]]);
      expect(parseMealGuidance(steer).excluded).toEqual([]);
      expect(meets(steer, [chicken])).toBe(true);
    },
  );
  it("binds negation to a food with simple qualifiers and across a food list", () => {
    expect(parseMealGuidance("without any chicken").excluded).toEqual([
      "chicken",
    ]);
    expect(parseMealGuidance("no chicken or fish").excluded).toEqual([
      "chicken",
      "fish",
    ]);
    expect(parseMealGuidance("no chicken or fish").required).toEqual([]);
    expect(parseMealGuidance("no chicken please and tofu").required).toEqual([
      ["tofu"],
    ]);
  });
  it.each([
    "no chicken, beef or fish",
    "without grilled chicken, roasted beef or smoked fish",
    "no chicken, beef, or fish",
  ])("preserves exclusion across comma-separated food lists: %s", (steer) => {
    expect(parseMealGuidance(steer).excluded).toEqual([
      "chicken",
      "beef",
      "fish",
    ]);
    expect(parseMealGuidance(steer).required).toEqual([]);
    expect(meets(steer, [food("beef", "Beef steak")])).toBe(false);
    expect(meets(steer, [prawns])).toBe(false);
  });
  it.each([
    "without grilled chicken",
    "no shredded chicken",
    "without any cooked chicken",
  ])(
    "does not turn an excluded prepared food into a requirement: %s",
    (steer) => {
      expect(parseMealGuidance(steer).excluded).toEqual(["chicken"]);
      expect(parseMealGuidance(steer).required).toEqual([]);
      expect(meets(steer, [chicken])).toBe(false);
    },
  );
  it("ends a comma exclusion list when explicit positive guidance starts", () => {
    expect(
      parseMealGuidance("no chicken, beef or fish, with tofu").required,
    ).toEqual([["tofu"]]);
    expect(meets("no chicken, beef or fish, with tofu", [tofu])).toBe(true);
  });
  it("uses the original food name, not an appended brand, as ingredient evidence", () => {
    const tuna = {
      ...food("tuna", "Chunk Light Tuna (Chicken of the Sea)"),
      unbrandedName: "Chunk Light Tuna",
    };
    expect(meets("chicken based", [tuna])).toBe(false);
    expect(canMeetGuidance([tuna], parseMealGuidance("chicken"))).toBe(false);
    expect(meets("tuna based", [tuna])).toBe(true);
    expect(meets("no chicken", [tuna])).toBe(true);
  });
  it("retains ingredients genuinely written in the food name's parentheses", () => {
    const named = {
      ...chicken,
      name: "Rice bowl (chicken breast) (Own brand)",
      unbrandedName: "Rice bowl (chicken breast)",
    };
    expect(meets("chicken based", [named])).toBe(true);
  });
  it("rejects a prawn-dominated meal with a chicken garnish", () => {
    expect(meets("chicken based", [chicken, prawns])).toBe(false);
    expect(meets("chicken or tofu", [chicken, tofu])).toBe(true);
  });
  it("keeps no-cook separate from ingredient negation and allows free-range chicken", () => {
    expect(
      meets("no-cook chicken", [
        { ...chicken, name: "Free-range chicken breast" },
      ]),
    ).toBe(true);
    expect(parseMealGuidance("no-cook chicken").quick).toBe(true);
  });
  it("retains each requested protein when variants would fill the cap", () => {
    const variants = Array.from({ length: 210 }, (_, i) =>
      food(
        `c${i}`,
        `Chicken ${String.fromCharCode(65 + (i % 26))} ${String.fromCharCode(65 + Math.floor(i / 26))}`,
      ),
    );
    const guidance = parseMealGuidance("chicken and tofu");
    const pool = assembleCandidates(
      [...variants, tofu],
      preferences,
      200,
      guidance,
    );
    expect(pool.candidates).toContainEqual(tofu);
    expect(canMeetGuidance(pool.candidates, guidance)).toBe(true);
  });
  it("counts a small chicken serving after its portion multiplier", () => {
    const sliced = food("sliced", "Chicken breast slices", 3);
    expect(meets("chicken", [sliced], 2)).toBe(true);
    expect(canMeetGuidance([sliced], parseMealGuidance("chicken"))).toBe(true);
    expect(
      canMeetGuidance(
        [{ ...sliced, maxServings: 1 }],
        parseMealGuidance("chicken"),
      ),
    ).toBe(false);
  });
  it("allows OR alternatives, requires AND requests, and respects contrast", () => {
    expect(meets("chicken or tofu", [tofu])).toBe(true);
    expect(meets("chicken or tofu", [prawns])).toBe(false);
    expect(meets("chicken and tofu", [chicken])).toBe(false);
    expect(meets("chicken and tofu", [chicken, tofu])).toBe(true);
    expect(meets("not chicken but tofu", [tofu])).toBe(true);
    expect(meets("no chicken or fish, with tofu", [tofu])).toBe(true);
    expect(meets("tofu instead of chicken", [tofu])).toBe(true);
  });
  it("keeps requested chicken through high protein prawns and own rows at the cap", () => {
    const guidance = parseMealGuidance("quick chicken based");
    const many = Array.from({ length: 250 }, (_, i) => ({
      ...prawns,
      id: `p${i}`,
      name: `Prawns portion ${String.fromCharCode(65 + (i % 26))} ${String.fromCharCode(65 + Math.floor(i / 26))}`,
      isOwn: true,
    }));
    const result = assembleCandidates(
      [...many, chicken],
      preferences,
      200,
      guidance,
    );
    expect(result.candidates).toContainEqual(chicken);
    expect(result.candidates.length).toBe(200);
    expect(guidanceSearchTerms(guidance)).toEqual(["chicken"]);
  });
  it("saved avoidances beat a conflicting request and absence is explicit", () => {
    const guidance = parseMealGuidance("chicken based");
    const result = assembleCandidates(
      [chicken, prawns],
      { ...preferences, avoidFoods: ["chicken"] },
      200,
      guidance,
    );
    expect(canMeetGuidance(result.candidates, guidance)).toBe(false);
    expect(canMeetGuidance([prawns], guidance)).toBe(false);
    expect(canMeetGuidance([], parseMealGuidance(null))).toBe(true);
  });
  it("does not turn arbitrary food prose into inferred ingredients", () => {
    expect(
      parseMealGuidance("something filling to take to work").required,
    ).toEqual([]);
    expect(parseMealGuidance("quick chicken").quick).toBe(true);
  });
});
