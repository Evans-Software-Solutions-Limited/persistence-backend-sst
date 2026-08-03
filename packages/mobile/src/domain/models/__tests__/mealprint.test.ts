import {
  ALLERGEN_LABELS,
  AVOID_ALLERGENS,
  DEFAULT_MEALPRINT_PREFERENCES,
  DIETARY_PATTERNS,
  EFFORT_LEVELS,
  LABEL_CHECK_COPY,
  MEDICAL_SCOPE_COPY,
  draftFromSuggestion,
  isAllergenKey,
  isDietaryPattern,
  isEffortLevel,
  partialEnforcementCopy,
  sumKeptDraftKcal,
  summarisePreferences,
  type MealprintPreferences,
  type MealSuggestion,
} from "../mealprint";

function prefs(over: Partial<MealprintPreferences> = {}): MealprintPreferences {
  return {
    userId: "user-1",
    dietaryPatterns: [],
    avoidAllergens: [],
    avoidFoods: [],
    likedFoods: [],
    mealsPerDay: 4,
    effortLevel: "balanced",
    locale: "en-GB",
    updatedAt: null,
    isDefault: false,
    ...over,
  };
}

function suggestion(over: Partial<MealSuggestion> = {}): MealSuggestion {
  return {
    name: "Greek yoghurt & berries",
    reason: "Hits your protein without much of the calorie budget.",
    items: [
      {
        candidateId: "food-1",
        kind: "food",
        name: "Greek yoghurt 0%",
        servings: 1.5,
        servingLabel: "170 g pot",
        kcal: 150,
        proteinG: 25,
        carbsG: 9,
        fatG: 0,
        unverified: false,
      },
      {
        candidateId: "food-2",
        kind: "food",
        name: "Blueberries",
        servings: 1,
        servingLabel: "80 g",
        kcal: 45,
        proteinG: 1,
        carbsG: 11,
        fatG: 0,
        unverified: true,
      },
    ],
    kcal: 195,
    proteinG: 26,
    carbsG: 20,
    fatG: 0,
    containsUnverified: true,
    partialEnforcementOnly: false,
    ...over,
  };
}

describe("Mealprint vocabularies mirror the backend", () => {
  // ⚠ These are not tautologies. Each list is duplicated in
  // `microservices/core/.../preferences/vocabulary.ts` and in the migration's
  // CHECK constraints; a value present here and absent there earns a 400 the user
  // cannot fix, and the reverse silently drops a preference the server honours.
  // Pinning the exact membership is what makes a one-sided edit fail loudly.
  it("carries the seven dietary patterns", () => {
    expect([...DIETARY_PATTERNS]).toEqual([
      "vegetarian",
      "vegan",
      "pescatarian",
      "halal",
      "kosher",
      "dairy_free",
      "gluten_free",
    ]);
  });

  it("carries exactly the UK FIC 14 allergens", () => {
    expect(AVOID_ALLERGENS).toHaveLength(14);
    expect([...AVOID_ALLERGENS]).toEqual([
      "celery",
      "gluten",
      "crustaceans",
      "eggs",
      "fish",
      "lupin",
      "milk",
      "molluscs",
      "mustard",
      "nuts",
      "peanuts",
      "sesame",
      "soybeans",
      "sulphites",
    ]);
  });

  it("keeps peanuts and tree nuts as SEPARATE chips with distinguishable labels", () => {
    // The backend tags them separately on purpose (`ALLERGEN_OFF_TAGS.nuts`
    // excludes `en:peanuts`), so a user avoiding both must select both — and the
    // labels have to make that legible rather than reading as a duplicate.
    expect(ALLERGEN_LABELS.nuts).toBe("Tree nuts");
    expect(ALLERGEN_LABELS.peanuts).toBe("Peanuts");
  });

  it("labels every allergen and every pattern (no undefined chip text)", () => {
    for (const key of AVOID_ALLERGENS) {
      expect(ALLERGEN_LABELS[key]).toBeTruthy();
    }
  });

  it("defaults to 4 meals and balanced effort (AC 1.4)", () => {
    expect(DEFAULT_MEALPRINT_PREFERENCES.mealsPerDay).toBe(4);
    expect(DEFAULT_MEALPRINT_PREFERENCES.effortLevel).toBe("balanced");
    expect(DEFAULT_MEALPRINT_PREFERENCES.dietaryPatterns).toEqual([]);
    expect(DEFAULT_MEALPRINT_PREFERENCES.avoidAllergens).toEqual([]);
  });
});

describe("guards", () => {
  it("accept known values and reject unknown ones", () => {
    expect(isDietaryPattern("vegan")).toBe(true);
    expect(isDietaryPattern("carnivore")).toBe(false);
    expect(isAllergenKey("sesame")).toBe(true);
    expect(isAllergenKey("kiwi")).toBe(false);
    expect(isEffortLevel("high_maintenance")).toBe(true);
    expect(isEffortLevel("extreme")).toBe(false);
  });

  it("cover every declared member (a guard that rejects its own vocabulary is worse than none)", () => {
    for (const pattern of DIETARY_PATTERNS) {
      expect(isDietaryPattern(pattern)).toBe(true);
    }
    for (const level of EFFORT_LEVELS) {
      expect(isEffortLevel(level)).toBe(true);
    }
  });
});

describe("LABEL_CHECK_COPY (AC 1.2)", () => {
  it("is the acceptance criterion's sentence, verbatim", () => {
    // ⚠ A legal surface. This assertion exists so a well-meaning copy edit is a
    // failing test rather than a silent change to a disclaimer about allergens.
    expect(LABEL_CHECK_COPY).toBe(
      "Mealprint filters known ingredients, but always check labels — it can't verify allergens or cross-contamination.",
    );
  });

  it("does not promise verification", () => {
    expect(LABEL_CHECK_COPY).not.toMatch(/guarantee|verified|safe/i);
  });
});

describe("MEDICAL_SCOPE_COPY (AC 1.5, locked decision 10)", () => {
  it("disclaims medical advice and points at a professional", () => {
    expect(MEDICAL_SCOPE_COPY).toMatch(/not medical advice/i);
    expect(MEDICAL_SCOPE_COPY).toMatch(/healthcare professional/i);
  });
});

describe("partialEnforcementCopy (locked decision 10)", () => {
  it("is null when no partially-enforceable pattern is active", () => {
    expect(partialEnforcementCopy([])).toBeNull();
    expect(partialEnforcementCopy(["vegan", "gluten_free"])).toBeNull();
  });

  it("names pork and alcohol for halal, and never claims certification", () => {
    const copy = partialEnforcementCopy(["halal"]);
    expect(copy).toContain("pork");
    expect(copy).toContain("alcohol");
    // ⚠ The enforced set must be the one `DIETARY_PATTERN_RULES` actually
    // applies. Halal does NOT apply the shellfish axis, so promising it would be
    // a claim the pipeline does not honour.
    expect(copy).not.toContain("shellfish");
    expect(copy).toMatch(/certification isn't in our food data/i);
  });

  it("names pork and shellfish for kosher — NOT alcohol", () => {
    const copy = partialEnforcementCopy(["kosher"]);
    expect(copy).toContain("pork");
    expect(copy).toContain("shellfish");
    expect(copy).not.toContain("alcohol");
  });

  it("unions the two when both are active, without repeating pork", () => {
    const copy = partialEnforcementCopy(["halal", "kosher"]) ?? "";
    expect(copy).toContain("Halal and kosher");
    expect(copy.match(/pork/g)).toHaveLength(1);
    expect(copy).toContain("alcohol");
    expect(copy).toContain("shellfish");
  });

  it("ignores unknown pattern strings rather than throwing", () => {
    expect(partialEnforcementCopy(["carnivore"])).toBeNull();
  });
});

describe("summarisePreferences", () => {
  it("is null for the untouched default row, so the caller can say 'not set up yet'", () => {
    expect(summarisePreferences(prefs({ isDefault: true }))).toBeNull();
  });

  it("is null when nothing has been read on this device", () => {
    expect(summarisePreferences(null)).toBeNull();
  });

  it("counts allergens SEPARATELY from dislikes", () => {
    // ⚠ The point of the assertion: a merged total would flatten a safety-relevant
    // list into the same figure as a taste preference.
    const summary =
      summarisePreferences(
        prefs({
          avoidAllergens: ["peanuts", "milk"],
          avoidFoods: ["olives", "mushrooms", "marmite"],
        }),
      ) ?? "";
    expect(summary).toContain("2 allergens avoided");
    expect(summary).toContain("3 disliked");
    expect(summary).not.toContain("5");
  });

  it("singularises a lone allergen", () => {
    expect(summarisePreferences(prefs({ avoidAllergens: ["fish"] }))).toContain(
      "1 allergen avoided",
    );
  });

  it("leads with the dietary patterns and always ends with meals + effort", () => {
    expect(
      summarisePreferences(
        prefs({
          dietaryPatterns: ["vegan", "gluten_free"],
          mealsPerDay: 5,
          effortLevel: "quick",
        }),
      ),
    ).toBe("Vegan and Gluten-free · 5 meals a day · quick & simple");
  });

  it("drops a pattern this build does not recognise instead of printing undefined", () => {
    const summary =
      summarisePreferences(
        prefs({ dietaryPatterns: ["vegan", "carnivore"] }),
      ) ?? "";
    expect(summary).toContain("Vegan");
    expect(summary).not.toContain("undefined");
  });
});

describe("draft helpers", () => {
  it("starts every item kept — the server already verified the whole composition", () => {
    const draft = draftFromSuggestion(suggestion(), "snack");
    expect(draft.items.every((item) => item.on)).toBe(true);
    expect(draft.slot).toBe("snack");
  });

  it("sums only the kept items' kcal", () => {
    const draft = draftFromSuggestion(suggestion(), "snack");
    expect(sumKeptDraftKcal(draft.items)).toBe(195);
    const dropped = draft.items.map((item, i) =>
      i === 1 ? { ...item, on: false } : item,
    );
    expect(sumKeptDraftKcal(dropped)).toBe(150);
  });

  it("sums to zero when everything is dropped", () => {
    const draft = draftFromSuggestion(suggestion(), "snack");
    const none = draft.items.map((item) => ({ ...item, on: false }));
    expect(sumKeptDraftKcal(none)).toBe(0);
  });

  it("carries the per-item `unverified` flag through untouched", () => {
    const draft = draftFromSuggestion(suggestion(), "lunch");
    expect(draft.items.map((i) => i.unverified)).toEqual([false, true]);
  });
});
