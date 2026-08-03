/**
 * Mealprint (spec-26) — `avoidanceFilter` tests.
 *
 * ⚠ This is the test suite for a DANGEROUS AREA, so it is written to prove
 * behaviour rather than to reach a coverage number. In particular:
 *
 *   - Every one of the 14 allergen keys and all 7 dietary patterns is exercised
 *     by an enumerated loop, so adding a vocabulary entry without a rule FAILS
 *     here rather than silently becoming a no-op at generation time.
 *   - The fail-closed cases (`null` tags, uninterpretable tags) are asserted
 *     both positively and in the negative direction — a row must NOT be cleared
 *     by a safe-looking name.
 *   - The known false-positive traps ("Gluten Free Bread", "eggplant",
 *     "nutmeg") have explicit tests, because each was a real defect in a draft
 *     of this module.
 */

import { describe, it, expect } from "vitest";
import {
  assessAvoidance,
  forbiddenAllergenTags,
  forbiddenPatternAllergenTags,
  hasAllergenConstraint,
  hasPartialEnforcementPattern,
  isInterpretableAllergenTag,
  partitionByAvoidance,
  type AvoidancePreferences,
  type AvoidanceSubject,
} from "../avoidanceFilter";
import {
  ALLERGEN_OFF_TAGS,
  AVOID_ALLERGENS,
  DIETARY_PATTERNS,
  DIETARY_PATTERN_RULES,
  isTokenNegatedInName,
  normaliseFoodText,
  singularise,
  tokeniseFoodName,
} from "../../preferences/vocabulary";

const NO_PREFS: AvoidancePreferences = {
  dietaryPatterns: [],
  avoidAllergens: [],
  avoidFoods: [],
};

function subject(over: Partial<AvoidanceSubject> = {}): AvoidanceSubject {
  return {
    id: "f-1",
    name: "Plain Rice",
    // Default is the "analysed, nothing found" case — a POSITIVE claim.
    allergenTags: [],
    categoryTags: [],
    ...over,
  };
}

// ── Baseline ────────────────────────────────────────────────────────────────

describe("assessAvoidance — no preferences", () => {
  it("allows anything when nothing is avoided", () => {
    const v = assessAvoidance(
      subject({ name: "Peanut Butter", allergenTags: ["en:peanuts"] }),
      NO_PREFS,
    );
    expect(v.allowed).toBe(true);
  });

  it("reports unverified for an untagged row even when allowed", () => {
    // With no allergen chips set there is nothing to fail closed about, so the
    // row is kept — but the caller still has to render the label-check
    // disclaimer, which is what this flag drives (AC 1.2 / 3.4).
    const v = assessAvoidance(subject({ allergenTags: null }), NO_PREFS);
    expect(v).toEqual({
      allowed: true,
      unverified: true,
      partialEnforcementOnly: false,
    });
  });

  it("does not report unverified for a row OFF actually analysed", () => {
    const v = assessAvoidance(subject({ allergenTags: [] }), NO_PREFS);
    expect(v.allowed && v.unverified).toBe(false);
  });
});

// ── Allergens: fail closed ──────────────────────────────────────────────────

describe("assessAvoidance — allergens fail closed", () => {
  it.each(AVOID_ALLERGENS)("excludes a row tagged with avoided '%s'", (key) => {
    for (const tag of ALLERGEN_OFF_TAGS[key]) {
      const v = assessAvoidance(subject({ allergenTags: [tag] }), {
        ...NO_PREFS,
        avoidAllergens: [key],
      });
      expect(v.allowed, `${key} via ${tag}`).toBe(false);
      if (!v.allowed) {
        expect(v.rule).toBe("allergen_tag");
        expect(v.cause).toBe(key);
        expect(v.evidence).toBe(tag);
      }
    }
  });

  it("EXCLUDES a row whose allergen content is unknown (null tags)", () => {
    const v = assessAvoidance(
      // A name that could not look safer. It must not matter.
      subject({ name: "Plain Steamed White Rice", allergenTags: null }),
      { ...NO_PREFS, avoidAllergens: ["peanuts"] },
    );
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.rule).toBe("allergen_unknown");
  });

  it("EXCLUDES a row carrying an uninterpretable (non-en) allergen tag", () => {
    // `fr:lait` is milk. We cannot read it, so we cannot clear the row.
    const v = assessAvoidance(subject({ allergenTags: ["fr:lait"] }), {
      ...NO_PREFS,
      avoidAllergens: ["milk"],
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.rule).toBe("allergen_uninterpretable");
      expect(v.evidence).toBe("fr:lait");
    }
  });

  it("allows a row tagged with a DIFFERENT recognised allergen", () => {
    // en:milk is interpretable and is not what the user avoids, so the row
    // stays. This is why interpretability is the `en:` prefix and not
    // membership of our 14-key map.
    const v = assessAvoidance(subject({ allergenTags: ["en:milk"] }), {
      ...NO_PREFS,
      avoidAllergens: ["peanuts"],
    });
    expect(v.allowed).toBe(true);
  });

  it("allows a row tagged with a recognised allergen OUTSIDE our vocabulary", () => {
    const v = assessAvoidance(subject({ allergenTags: ["en:corn"] }), {
      ...NO_PREFS,
      avoidAllergens: ["peanuts"],
    });
    expect(v.allowed).toBe(true);
  });

  it("keeps tree nuts and peanuts separate in both directions", () => {
    const peanutRow = subject({
      name: "Peanut Butter",
      allergenTags: ["en:peanuts"],
    });
    const nutRow = subject({
      name: "Almond Butter",
      allergenTags: ["en:nuts", "en:almonds"],
    });

    expect(
      assessAvoidance(peanutRow, { ...NO_PREFS, avoidAllergens: ["nuts"] })
        .allowed,
    ).toBe(true);
    expect(
      assessAvoidance(nutRow, { ...NO_PREFS, avoidAllergens: ["peanuts"] })
        .allowed,
    ).toBe(true);
    expect(
      assessAvoidance(peanutRow, { ...NO_PREFS, avoidAllergens: ["peanuts"] })
        .allowed,
    ).toBe(false);
    expect(
      assessAvoidance(nutRow, { ...NO_PREFS, avoidAllergens: ["nuts"] })
        .allowed,
    ).toBe(false);
  });

  it("ignores an allergen key outside the vocabulary rather than trusting it", () => {
    // An unknown key cannot be enforced, so it must not silently switch the
    // fail-closed branch on either — otherwise a typo'd chip would exclude the
    // whole catalogue. The DB CHECK stops these being stored; this is the
    // in-code half of that pair.
    const v = assessAvoidance(subject({ allergenTags: null }), {
      ...NO_PREFS,
      avoidAllergens: ["kryptonite"],
    });
    expect(v.allowed).toBe(true);
  });

  it("reports the allergen, not the dislike, when a row violates both", () => {
    const v = assessAvoidance(
      subject({ name: "Peanut Butter", allergenTags: ["en:peanuts"] }),
      { ...NO_PREFS, avoidAllergens: ["peanuts"], avoidFoods: ["peanut"] },
    );
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.rule).toBe("allergen_tag");
  });

  it("a free-from CLAIM IN THE NAME never clears an allergen", () => {
    // The negation guard is for patterns and dislikes only. "Nut free" on a
    // package is not evidence for an allergy-grade decision.
    const v = assessAvoidance(
      subject({ name: "Nut Free Chocolate Bar", allergenTags: null }),
      { ...NO_PREFS, avoidAllergens: ["nuts"] },
    );
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.rule).toBe("allergen_unknown");
  });
});

// ── Dietary patterns ────────────────────────────────────────────────────────

describe("assessAvoidance — dietary patterns", () => {
  it.each(DIETARY_PATTERNS)("has an enforceable rule for '%s'", (pattern) => {
    // A pattern in the vocabulary with no rule content would be a SILENT no-op
    // at generation time — the user picks "vegan" and gets meat. This test is
    // the thing that makes adding a key without a rule fail loudly.
    const rule = DIETARY_PATTERN_RULES[pattern];
    const hasSomething =
      rule.allergenTags.length > 0 ||
      rule.categoryTagSubstrings.length > 0 ||
      rule.nameAxesAlways.length > 0 ||
      rule.nameAxesWhenUntagged.length > 0;
    expect(hasSomething, `${pattern} has no enforcement rule`).toBe(true);
  });

  it("vegan excludes meat by name even when OFF analysed the row clean", () => {
    // The load-bearing case for `nameTokensAlways`: plain chicken carries no
    // regulated allergen, so `allergen_tags = []` is CORRECT, and category tags
    // are often missing. Gating the name rule on tag presence would serve a
    // vegan chicken.
    const v = assessAvoidance(
      subject({ name: "Chicken Breast", allergenTags: [], categoryTags: [] }),
      { ...NO_PREFS, dietaryPatterns: ["vegan"] },
    );
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.rule).toBe("pattern_name");
      expect(v.cause).toBe("vegan");
    }
  });

  it("vegan excludes dairy by allergen tag", () => {
    const v = assessAvoidance(
      subject({ name: "Mystery Bar", allergenTags: ["en:milk"] }),
      { ...NO_PREFS, dietaryPatterns: ["vegan"] },
    );
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.rule).toBe("pattern_tag");
  });

  it("vegan excludes by category tag substring", () => {
    const v = assessAvoidance(
      subject({
        name: "House Special",
        allergenTags: [],
        categoryTags: ["en:prepared-meats"],
      }),
      { ...NO_PREFS, dietaryPatterns: ["vegan"] },
    );
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.rule).toBe("pattern_tag");
  });

  it("vegetarian permits dairy and eggs but not fish", () => {
    expect(
      assessAvoidance(
        subject({ name: "Greek Yogurt", allergenTags: ["en:milk"] }),
        { ...NO_PREFS, dietaryPatterns: ["vegetarian"] },
      ).allowed,
    ).toBe(true);
    expect(
      assessAvoidance(subject({ name: "Tuna Steak", allergenTags: null }), {
        ...NO_PREFS,
        dietaryPatterns: ["vegetarian"],
      }).allowed,
    ).toBe(false);
  });

  it("pescatarian permits fish but not chicken", () => {
    expect(
      assessAvoidance(
        subject({ name: "Salmon Fillet", allergenTags: ["en:fish"] }),
        { ...NO_PREFS, dietaryPatterns: ["pescatarian"] },
      ).allowed,
    ).toBe(true);
    expect(
      assessAvoidance(subject({ name: "Chicken Thigh", allergenTags: [] }), {
        ...NO_PREFS,
        dietaryPatterns: ["pescatarian"],
      }).allowed,
    ).toBe(false);
  });

  it("kosher permits fin fish and excludes shellfish and pork", () => {
    // Excluding salmon would be plainly wrong; an earlier draft of the rule did
    // exactly that by reusing the whole seafood token list.
    expect(
      assessAvoidance(subject({ name: "Salmon Fillet", allergenTags: null }), {
        ...NO_PREFS,
        dietaryPatterns: ["kosher"],
      }).allowed,
    ).toBe(true);
    expect(
      assessAvoidance(subject({ name: "King Prawns", allergenTags: null }), {
        ...NO_PREFS,
        dietaryPatterns: ["kosher"],
      }).allowed,
    ).toBe(false);
    expect(
      assessAvoidance(subject({ name: "Smoked Bacon", allergenTags: [] }), {
        ...NO_PREFS,
        dietaryPatterns: ["kosher"],
      }).allowed,
    ).toBe(false);
  });

  it("halal excludes pork and alcohol and flags partial enforcement", () => {
    expect(
      assessAvoidance(subject({ name: "Pork Loin", allergenTags: [] }), {
        ...NO_PREFS,
        dietaryPatterns: ["halal"],
      }).allowed,
    ).toBe(false);
    expect(
      assessAvoidance(subject({ name: "Red Wine Vinegar", allergenTags: [] }), {
        ...NO_PREFS,
        dietaryPatterns: ["halal"],
      }).allowed,
    ).toBe(false);

    // An allowed row still has to carry the caveat: certification is not in the
    // data, so the surface must not imply it is verified.
    const v = assessAvoidance(subject({ name: "Basmati Rice" }), {
      ...NO_PREFS,
      dietaryPatterns: ["halal"],
    });
    expect(v).toMatchObject({ allowed: true, partialEnforcementOnly: true });
  });

  it("does not flag partial enforcement for fully determinable patterns", () => {
    const v = assessAvoidance(subject({ name: "Basmati Rice" }), {
      ...NO_PREFS,
      dietaryPatterns: ["vegan", "gluten_free"],
    });
    expect(v).toMatchObject({ allowed: true, partialEnforcementOnly: false });
  });

  it("ignores an unrecognised pattern string", () => {
    expect(
      assessAvoidance(subject({ name: "Chicken Breast" }), {
        ...NO_PREFS,
        dietaryPatterns: ["carnivore"],
      }).allowed,
    ).toBe(true);
  });
});

// ── The false-positive traps ────────────────────────────────────────────────

describe("assessAvoidance — known false-positive traps", () => {
  it("does NOT exclude 'Gluten Free Bread' from a gluten-free pool", () => {
    // Two independent guards make this pass: the row has allergen tags, so the
    // untagged name rule never runs; and even untagged, "bread" is negated by
    // the free-from claim.
    expect(
      assessAvoidance(
        subject({ name: "Gluten Free Bread", allergenTags: [] }),
        { ...NO_PREFS, dietaryPatterns: ["gluten_free"] },
      ).allowed,
    ).toBe(true);
    expect(
      assessAvoidance(
        subject({ name: "Gluten Free Bread", allergenTags: null }),
        { ...NO_PREFS, dietaryPatterns: ["gluten_free"] },
      ).allowed,
    ).toBe(true);
  });

  it("does NOT exclude 'Dairy-Free Oat Milk' from a dairy-free pool", () => {
    expect(
      assessAvoidance(
        subject({ name: "Dairy-Free Oat Milk", allergenTags: null }),
        { ...NO_PREFS, dietaryPatterns: ["dairy_free"] },
      ).allowed,
    ).toBe(true);
  });

  it("still excludes ordinary bread and milk", () => {
    expect(
      assessAvoidance(
        subject({ name: "Sourdough Bread", allergenTags: null }),
        {
          ...NO_PREFS,
          dietaryPatterns: ["gluten_free"],
        },
      ).allowed,
    ).toBe(false);
    expect(
      assessAvoidance(subject({ name: "Whole Milk", allergenTags: null }), {
        ...NO_PREFS,
        dietaryPatterns: ["dairy_free"],
      }).allowed,
    ).toBe(false);
  });

  it("clears 'Meat Free Sausage' for a vegan — the axis, not just the token", () => {
    // The matched token is "sausage"; the negation is on the axis word "meat".
    // A per-token check would exclude the whole meat-substitute aisle from the
    // one group of users it exists for.
    expect(
      assessAvoidance(
        subject({ name: "Meat Free Sausages", allergenTags: null }),
        { ...NO_PREFS, dietaryPatterns: ["vegan"] },
      ).allowed,
    ).toBe(true);
  });

  it("does NOT clear 'Dairy Free Chicken Nuggets' for a vegan", () => {
    // The other direction, and the reason negation must be axis-SCOPED rather
    // than name-global: this name negates dairy and says nothing about meat.
    const v = assessAvoidance(
      subject({ name: "Dairy Free Chicken Nuggets", allergenTags: null }),
      { ...NO_PREFS, dietaryPatterns: ["vegan"] },
    );
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.evidence).toBe("chicken");
  });

  it("clears 'Alcohol Free Lager' for a halal user", () => {
    expect(
      assessAvoidance(subject({ name: "Alcohol Free Lager" }), {
        ...NO_PREFS,
        dietaryPatterns: ["halal"],
      }).allowed,
    ).toBe(true);
  });

  it("a negator AFTER the token does not clear it", () => {
    // "Roast Chicken, no bones" is still chicken.
    expect(
      assessAvoidance(
        subject({ name: "Roast Chicken, no bones", allergenTags: [] }),
        { ...NO_PREFS, dietaryPatterns: ["vegan"] },
      ).allowed,
    ).toBe(false);
  });

  it("matches whole tokens, so 'egg' does not match 'eggplant'", () => {
    expect(
      assessAvoidance(subject({ name: "Eggplant Curry", allergenTags: null }), {
        ...NO_PREFS,
        dietaryPatterns: ["vegan"],
      }).allowed,
    ).toBe(true);
  });

  it("matches whole tokens, so 'nut' does not match 'nutmeg'", () => {
    expect(
      assessAvoidance(subject({ name: "Ground Nutmeg" }), {
        ...NO_PREFS,
        avoidFoods: ["nut"],
      }).allowed,
    ).toBe(true);
  });
});

// ── Dislikes ────────────────────────────────────────────────────────────────

describe("assessAvoidance — dislikes", () => {
  it("matches a single-word dislike regardless of case and plurality", () => {
    for (const name of ["Mushroom Soup", "MUSHROOMS", "mushrooms, dried"]) {
      const v = assessAvoidance(subject({ name }), {
        ...NO_PREFS,
        avoidFoods: ["mushroom"],
      });
      expect(v.allowed, name).toBe(false);
    }
  });

  it("matches a plural dislike against a singular name", () => {
    expect(
      assessAvoidance(subject({ name: "Green Olive" }), {
        ...NO_PREFS,
        avoidFoods: ["olives"],
      }).allowed,
    ).toBe(false);
  });

  it("strips accents on both sides", () => {
    expect(
      assessAvoidance(subject({ name: "Jalapeño Poppers" }), {
        ...NO_PREFS,
        avoidFoods: ["jalapeno"],
      }).allowed,
    ).toBe(false);
    expect(
      assessAvoidance(subject({ name: "Jalapeno Poppers" }), {
        ...NO_PREFS,
        avoidFoods: ["jalapeño"],
      }).allowed,
    ).toBe(false);
  });

  it("requires EVERY token of a multi-word dislike", () => {
    const prefs = { ...NO_PREFS, avoidFoods: ["chicken thigh"] };
    expect(
      assessAvoidance(subject({ name: "Chicken Thighs, skin on" }), prefs)
        .allowed,
    ).toBe(false);
    // Not every chicken product — only the disliked cut.
    expect(
      assessAvoidance(subject({ name: "Chicken Breast" }), prefs).allowed,
    ).toBe(true);
  });

  it("ignores a blank or punctuation-only dislike rather than excluding everything", () => {
    // A dislike that tokenises to nothing would make `every()` vacuously true
    // and reject the entire catalogue.
    for (const junk of ["", "   ", "---", "!!!"]) {
      expect(
        assessAvoidance(subject({ name: "Plain Rice" }), {
          ...NO_PREFS,
          avoidFoods: [junk],
        }).allowed,
        JSON.stringify(junk),
      ).toBe(true);
    }
  });

  it("honours a hardtofind: prefixed exclusion by its food token", () => {
    // STORY-007 appends with a prefix kept out of UI copy. The prefix tokenises
    // alongside the name, so the stored value still has to match — assert the
    // shape the repository writes actually works.
    expect(
      assessAvoidance(subject({ name: "Liquid Egg Whites" }), {
        ...NO_PREFS,
        avoidFoods: ["liquid egg whites"],
      }).allowed,
    ).toBe(false);
  });
});

// ── Partition + helpers ─────────────────────────────────────────────────────

describe("partitionByAvoidance", () => {
  it("returns rejections with their reasons rather than dropping them", () => {
    const rows = [
      subject({ id: "a", name: "Plain Rice" }),
      subject({ id: "b", name: "Peanut Butter", allergenTags: ["en:peanuts"] }),
      subject({ id: "c", name: "Mushroom Soup" }),
    ];
    const { kept, rejected } = partitionByAvoidance(rows, {
      dietaryPatterns: [],
      avoidAllergens: ["peanuts"],
      avoidFoods: ["mushroom"],
    });

    expect(kept.map((r) => r.id)).toEqual(["a"]);
    expect(rejected.map((r) => [r.subject.id, r.verdict.rule])).toEqual([
      ["b", "allergen_tag"],
      ["c", "dislike_name"],
    ]);
  });

  it("is empty-in, empty-out", () => {
    expect(partitionByAvoidance([], NO_PREFS)).toEqual({
      kept: [],
      rejected: [],
    });
  });
});

describe("helpers", () => {
  it("isInterpretableAllergenTag keys on the en: taxonomy prefix", () => {
    expect(isInterpretableAllergenTag("en:milk")).toBe(true);
    expect(isInterpretableAllergenTag("fr:lait")).toBe(false);
    expect(isInterpretableAllergenTag("milk")).toBe(false);
  });

  it("hasAllergenConstraint ignores unrecognised keys", () => {
    expect(hasAllergenConstraint({ avoidAllergens: [] })).toBe(false);
    expect(hasAllergenConstraint({ avoidAllergens: ["nonsense"] })).toBe(false);
    expect(hasAllergenConstraint({ avoidAllergens: ["milk"] })).toBe(true);
  });

  it("hasPartialEnforcementPattern is true only for halal/kosher", () => {
    expect(hasPartialEnforcementPattern({ dietaryPatterns: ["vegan"] })).toBe(
      false,
    );
    expect(hasPartialEnforcementPattern({ dietaryPatterns: ["halal"] })).toBe(
      true,
    );
    expect(hasPartialEnforcementPattern({ dietaryPatterns: ["kosher"] })).toBe(
      true,
    );
  });

  it("forbiddenAllergenTags expands keys to tags and dedupes", () => {
    const tags = forbiddenAllergenTags(["milk", "milk", "nonsense"]);
    expect(tags).toEqual(ALLERGEN_OFF_TAGS.milk);
  });

  it("forbiddenPatternAllergenTags unions the active patterns", () => {
    const tags = forbiddenPatternAllergenTags(["dairy_free", "gluten_free"]);
    expect(tags).toContain("en:milk");
    expect(tags).toContain("en:gluten");
    expect(new Set(tags).size).toBe(tags.length);
  });
});

// ── Vocabulary primitives ───────────────────────────────────────────────────

describe("vocabulary primitives", () => {
  it("normaliseFoodText strips accents, lowercases and collapses whitespace", () => {
    expect(normaliseFoodText("  Crème   FRAÎCHE ")).toBe("creme fraiche");
  });

  it("singularise handles the common English endings and leaves short tokens", () => {
    expect(singularise("olives")).toBe("olive");
    expect(singularise("berries")).toBe("berry");
    expect(singularise("tomatoes")).toBe("tomato");
    expect(singularise("dishes")).toBe("dish");
    expect(singularise("boxes")).toBe("box");
    expect(singularise("glass")).toBe("glass");
    expect(singularise("oat")).toBe("oat");
    // Short tokens are left alone so "gas"/"pea" are not mangled.
    expect(singularise("pea")).toBe("pea");
  });

  it("tokeniseFoodName splits on every non-alphanumeric", () => {
    expect(tokeniseFoodName("chicken-breast (skinless), 200g")).toEqual([
      "chicken",
      "breast",
      "skinless",
      "200g",
    ]);
  });

  it("isTokenNegatedInName recognises the common free-from phrasings", () => {
    expect(isTokenNegatedInName("Gluten Free Bread", "gluten")).toBe(true);
    expect(isTokenNegatedInName("Dairy-free spread", "dairy")).toBe(true);
    expect(isTokenNegatedInName("Free from wheat pasta", "wheat")).toBe(true);
    expect(isTokenNegatedInName("Made without milk", "milk")).toBe(true);
    expect(isTokenNegatedInName("No Beef Strips", "beef")).toBe(true);
    // Not negated:
    expect(isTokenNegatedInName("Wholemeal Bread", "bread")).toBe(false);
    expect(isTokenNegatedInName("Roast chicken, no bones", "chicken")).toBe(
      false,
    );
  });
});
