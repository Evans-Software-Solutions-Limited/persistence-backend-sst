/**
 * Mealprint (spec-26) — the client-side mirror of the Phase 0/1 backend
 * contract (PR #350). Preferences (T-0.6) and fill-my-macros suggestions
 * (T-1.5).
 *
 * ## Three contracts this file exists to keep visible at the type level
 *
 * 1. **{@link MealSuggestResult.labelCheckRequired} is the disclaimer's ONLY
 *    trigger, and it is always `true`.** The server returns it unconditionally
 *    and says why in `nutritionAiMealSuggestHandler`'s docstring:
 *    `mapOffAllergenTags` returns `[]` — which reads as "analysed, nothing
 *    found" — whenever a product has ingredient text, *without knowing OFF
 *    actually parsed it*. A foreign-language ingredient list, a "see packaging"
 *    placeholder and a genuinely clean analysis are indistinguishable, and those
 *    are the rows most likely to be wrong. So gating {@link LABEL_CHECK_COPY} on
 *    the narrower {@link MealSuggestResult.containsUnverified} would suppress it
 *    exactly where it matters most. `containsUnverified` is the STRONGER
 *    "we don't know what is in this at all" signal and is rendered separately.
 *
 * 2. **{@link LABEL_CHECK_COPY} is AC 1.2 verbatim and is a legal surface.** Do
 *    not paraphrase, shorten, or split it across elements. Same for
 *    {@link MEDICAL_SCOPE_COPY} (AC 1.5 / locked decision 10).
 *
 * 3. **`partialEnforcementOnly` must never imply certification.** Halal and
 *    kosher certification appears nowhere in the Open Food Facts data, so the
 *    backend enforces only the determinable subset and flags the gap. See
 *    {@link partialEnforcementCopy}, which names exactly what is enforced and
 *    nothing more (locked decision 10).
 *
 * Every vocabulary below MIRRORS
 * `microservices/core/src/application/nutrition/mealprint/preferences/vocabulary.ts`
 * and the CHECK constraints in `20260803120100_nutrition_preferences.sql`. A
 * value this file allows and the server does not earns a 400 naming the field;
 * a value the server allows and this file does not is simply unreachable from
 * the app. Keep all three in step.
 */

import type { MealSlot } from "./nutrition";

// ─── Vocabularies (mirror the backend, AC 1.1) ───────────────────────────────

export const DIETARY_PATTERNS = [
  "vegetarian",
  "vegan",
  "pescatarian",
  "halal",
  "kosher",
  "dairy_free",
  "gluten_free",
] as const;

export type DietaryPattern = (typeof DIETARY_PATTERNS)[number];

/**
 * The UK FIC 14-allergen set — Brad signed this chip set off 2026-07-24, and it
 * is the CEILING of the allergen vocabulary. Anything outside it is a dislike
 * ({@link MealprintPreferences.avoidFoods}), which is name-matched and carries
 * no safety claim.
 */
export const AVOID_ALLERGENS = [
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
] as const;

export type AllergenKey = (typeof AVOID_ALLERGENS)[number];

export const EFFORT_LEVELS = ["quick", "balanced", "high_maintenance"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** v1 ships en-GB only (locked decision 5); the field exists so adding one is data. */
export const SUPPORTED_LOCALES = ["en-GB"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const MIN_MEALS_PER_DAY = 2;
export const MAX_MEALS_PER_DAY = 6;

// ─── Guards ─────────────────────────────────────────────────────────────────
//
// ⚠ These exist because `MealprintPreferences` types its arrays as `string[]`,
// not as the unions. That is faithful to the wire: the handler validates against
// the closed vocabularies, but a row written by an OLDER app build against a
// NEWER server (or vice versa, after a vocabulary extension) can carry a value
// this build has no label, chip or rule for.
//
// Filtering through these rather than casting is what keeps that harmless. A cast
// would render a chip with an `undefined` label and — worse — echo the unknown
// value straight back on the next save, so a user who edited their preferences on
// an old build would silently re-assert a pattern they cannot see.

const DIETARY_PATTERN_SET: ReadonlySet<string> = new Set(DIETARY_PATTERNS);
export function isDietaryPattern(value: string): value is DietaryPattern {
  return DIETARY_PATTERN_SET.has(value);
}

const ALLERGEN_SET: ReadonlySet<string> = new Set(AVOID_ALLERGENS);
export function isAllergenKey(value: string): value is AllergenKey {
  return ALLERGEN_SET.has(value);
}

const EFFORT_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);
export function isEffortLevel(value: string): value is EffortLevel {
  return EFFORT_SET.has(value);
}

// ─── Display labels ─────────────────────────────────────────────────────────

export const DIETARY_PATTERN_LABELS: Readonly<Record<DietaryPattern, string>> =
  {
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    pescatarian: "Pescatarian",
    halal: "Halal",
    kosher: "Kosher",
    dairy_free: "Dairy-free",
    gluten_free: "Gluten-free",
  };

/**
 * ⚠ These are the REGULATED allergen names, not friendlier synonyms.
 *
 * "Nuts" stays "Tree nuts" and peanuts stay separate because the backend tags
 * them separately and folding them together would misreport which chip caused
 * an exclusion — `ALLERGEN_OFF_TAGS.nuts` deliberately excludes `en:peanuts`. A
 * user who avoids both picks both chips, and the labels have to make that
 * obvious rather than looking like a duplicate.
 */
export const ALLERGEN_LABELS: Readonly<Record<AllergenKey, string>> = {
  celery: "Celery",
  gluten: "Gluten",
  crustaceans: "Crustaceans",
  eggs: "Eggs",
  fish: "Fish",
  lupin: "Lupin",
  milk: "Milk",
  molluscs: "Molluscs",
  mustard: "Mustard",
  nuts: "Tree nuts",
  peanuts: "Peanuts",
  sesame: "Sesame",
  soybeans: "Soya",
  sulphites: "Sulphites",
};

export const EFFORT_LEVEL_LABELS: Readonly<Record<EffortLevel, string>> = {
  quick: "Quick & simple",
  balanced: "Balanced",
  high_maintenance: "High-maintenance",
};

export const EFFORT_LEVEL_BLURBS: Readonly<Record<EffortLevel, string>> = {
  quick: "Minimal cooking, few ingredients",
  balanced: "A normal amount of cooking",
  high_maintenance: "Batch-prep and proper cooking",
};

// ─── Preferences (AC 1.1–1.5) ───────────────────────────────────────────────

/**
 * `GET /nutrition/preferences` — the 404-free read. The endpoint returns
 * {@link DEFAULT_MEALPRINT_PREFERENCES} with `isDefault: true` when the user has
 * no row, so no consumer needs a "did you mean empty?" branch.
 */
export type MealprintPreferences = {
  readonly userId: string;
  readonly dietaryPatterns: readonly string[];
  readonly avoidAllergens: readonly string[];
  readonly avoidFoods: readonly string[];
  readonly likedFoods: readonly string[];
  readonly mealsPerDay: number;
  readonly effortLevel: EffortLevel;
  readonly locale: string;
  readonly updatedAt: string | null;
  /**
   * TRUE when no row exists and these are the defaults.
   *
   * ⚠ This is what distinguishes "skipped the wizard" from "deliberately chose
   * the default shape", and it is why the entry card can offer a first-run
   * wizard without guessing. Comparing against the defaults would misfire the
   * moment a user saves them on purpose.
   */
  readonly isDefault: boolean;
};

/**
 * `PUT /nutrition/preferences` body. Server-side the arrays are validated
 * against the closed vocabularies and the free-text entries are normalised on
 * write, so the client sends what the user typed and reads back the canonical
 * form.
 */
export type SetMealprintPreferencesInput = {
  readonly dietaryPatterns: readonly DietaryPattern[];
  readonly avoidAllergens: readonly AllergenKey[];
  readonly avoidFoods: readonly string[];
  readonly likedFoods: readonly string[];
  readonly mealsPerDay: number;
  readonly effortLevel: EffortLevel;
  readonly locale: SupportedLocale;
};

/** AC 1.4 — the wizard is skippable, and this is what a skip means. */
export const DEFAULT_MEALPRINT_PREFERENCES: SetMealprintPreferencesInput = {
  dietaryPatterns: [],
  avoidAllergens: [],
  avoidFoods: [],
  likedFoods: [],
  mealsPerDay: 4,
  effortLevel: "balanced",
  locale: "en-GB",
};

/**
 * Free-text caps, duplicated from the backend's `MAX_FREE_TEXT_*` so the editor
 * refuses an over-long entry inline instead of round-tripping for a 400.
 *
 * Not arbitrary on either side: every entry is rendered into the model prompt,
 * so an unbounded list is an unbounded prompt — a cost channel AND a steering
 * channel the user controls.
 */
export const MAX_FREE_TEXT_ITEMS = 60;
export const MAX_FREE_TEXT_LENGTH = 120;

/** Bound on the suggest steer, mirroring the handler's `t.String({ maxLength: 200 })`. */
export const MAX_STEER_LENGTH = 200;

// ─── Copy that is a contract, not a string ──────────────────────────────────

/**
 * AC 1.2 / AC 3.4, **verbatim**. Rendered whenever
 * {@link MealSuggestResult.labelCheckRequired} is true (always) and whenever an
 * allergen chip is active in the preferences editor.
 *
 * ⚠ Do not paraphrase or abbreviate this. It is the only thing standing between
 * a tag-derived filter and a user treating it as an allergen guarantee, and the
 * literature the spec cites (§ Market context: ~78 % of free nutrition apps
 * failed basic allergen flagging) is why it is worded as a limitation rather
 * than a reassurance.
 */
export const LABEL_CHECK_COPY =
  "Mealprint filters known ingredients, but always check labels — it can't verify allergens or cross-contamination.";

/** AC 1.5 / locked decision 10 — shown in the preferences wizard footer. */
export const MEDICAL_SCOPE_COPY =
  "Mealprint is a fitness and lifestyle feature, not medical advice. If you have a medical condition or a clinically managed diet, speak to a healthcare professional.";

/**
 * The name of what a `partialEnforcementOnly` pattern actually enforces —
 * never a claim about certification, which does not exist in the data.
 *
 * The lists mirror `DIETARY_PATTERN_RULES` exactly: `halal` applies the pork and
 * alcohol axes; `kosher` applies pork and shellfish (fin fish with scales is
 * kosher, so the seafood axis is deliberately NOT applied). Returns `null` when
 * no partially-enforceable pattern is active, so callers render nothing rather
 * than an empty caveat.
 */
export function partialEnforcementCopy(
  patterns: readonly string[],
): string | null {
  const halal = patterns.includes("halal");
  const kosher = patterns.includes("kosher");
  if (!halal && !kosher) return null;

  // Union of the enforced axes, in a fixed order so the sentence is stable.
  const enforced: string[] = ["pork"];
  if (halal) enforced.push("alcohol");
  if (kosher) enforced.push("shellfish");

  const which =
    halal && kosher ? "Halal and kosher" : halal ? "Halal" : "Kosher";
  return `${which} certification isn't in our food data, so Mealprint can only exclude ${formatList(enforced)} by ingredient. Check for certification yourself.`;
}

/**
 * One-line summary of saved preferences, for the Fuel Targets row.
 *
 * `null` when there is nothing to summarise — either the row is unknown on this
 * device or it is the untouched default. The caller renders its own "Not set up
 * yet" in that case, so this never has to guess which of the two it is.
 *
 * ⚠ Allergens are named FIRST and counted separately from dislikes, never merged
 * into one total. They are the safety-relevant list, and a summary reading
 * "5 foods avoided" would flatten "2 allergens" into the same sentence as
 * "3 things I find boring" — the exact conflation the editor's chip styling
 * exists to prevent.
 */
export function summarisePreferences(
  preferences: MealprintPreferences | null,
): string | null {
  if (preferences === null || preferences.isDefault) return null;

  const parts: string[] = [];
  const patterns = preferences.dietaryPatterns.filter(isDietaryPattern);
  if (patterns.length > 0) {
    parts.push(
      formatList(patterns.map((pattern) => DIETARY_PATTERN_LABELS[pattern])),
    );
  }
  if (preferences.avoidAllergens.length > 0) {
    parts.push(
      `${preferences.avoidAllergens.length} allergen${preferences.avoidAllergens.length === 1 ? "" : "s"} avoided`,
    );
  }
  if (preferences.avoidFoods.length > 0) {
    parts.push(`${preferences.avoidFoods.length} disliked`);
  }
  parts.push(`${preferences.mealsPerDay} meals a day`);
  parts.push(EFFORT_LEVEL_LABELS[preferences.effortLevel].toLowerCase());
  return parts.join(" · ");
}

/** "a", "a and b", "a, b and c" — en-GB serial comma omitted. */
function formatList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
}

// ─── Suggestions (STORY-003) ────────────────────────────────────────────────

export type SuggestShape = "snack" | "meal" | "either";

export const SUGGEST_SHAPE_LABELS: Readonly<Record<SuggestShape, string>> = {
  snack: "Snack",
  meal: "Meal",
  either: "Either",
};

/**
 * `POST /nutrition/ai/meal-suggest` body. `date` is the DEVICE's local day, not
 * server time — the same reason `GET /nutrition/today` takes it: deriving it
 * server-side would give a user in NZ the wrong day's entries.
 */
export type MealSuggestInput = {
  readonly shape: SuggestShape;
  readonly date: string;
  readonly steer?: string;
};

/**
 * One composed item inside a suggestion. Every macro here was **recomputed
 * server-side from the resolved database row × servings** — the model is never
 * allowed to emit a number (locked decision 1). Render these as authoritative.
 */
export type MealSuggestionItem = {
  readonly candidateId: string;
  readonly kind: "food" | "recipe" | "meal";
  readonly name: string;
  readonly servings: number;
  readonly servingLabel: string;
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  /** TRUE when this item's allergen content is UNKNOWN (AC 2.2). */
  readonly unverified: boolean;
};

export type MealSuggestion = {
  readonly name: string;
  /** Untrusted model prose. Render as plain text only — never markup or a link. */
  readonly reason: string;
  readonly items: readonly MealSuggestionItem[];
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  /** TRUE when ANY item's allergen content is unknown. */
  readonly containsUnverified: boolean;
  /** TRUE when an active pattern cannot be fully enforced (halal/kosher). */
  readonly partialEnforcementOnly: boolean;
};

export type MealSuggestRemaining = {
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
};

/**
 * Why an otherwise-successful request returned nothing.
 *
 * ⚠ These are **200s carrying an answer**, not failures — "you have 40 kcal
 * left" and "your restrictions exclude everything we stock" are things the
 * client can say precisely, and neither consumed the user's daily ceiling.
 *
 * ⚠ `no_candidates` is the EXPECTED state for any user with an allergen chip set
 * until the Open Food Facts re-seed lands: the tag columns are NULL on all
 * ~144k seeded rows and `avoidanceFilter` treats NULL as unknown-and-unsafe, so
 * every curated food is excluded from an allergen-filtered pool. That is correct
 * fail-closed behaviour, so the copy for this state must be actionable
 * (loosen a chip / add your own foods) rather than reading as a bug.
 */
export type MealSuggestEmptyReason =
  | "no_targets"
  | "budget_exhausted"
  | "no_candidates";

export type MealSuggestResult = {
  readonly suggestions: readonly MealSuggestion[];
  readonly emptyReason: MealSuggestEmptyReason | null;
  /** `null` on every empty result — there was no usable budget to report. */
  readonly remaining: MealSuggestRemaining | null;
  readonly containsUnverified: boolean;
  readonly partialEnforcementOnly: boolean;
  /** ⚠ Always true. See this file's docstring, contract 1. */
  readonly labelCheckRequired: boolean;
};

/**
 * A suggestion staged for logging: the server's suggestion plus the per-item
 * keep/drop state the review step owns. Nothing is logged until the user
 * confirms (locked decision 3).
 */
export type MealprintDraftItem = MealSuggestionItem & { readonly on: boolean };

export type MealprintDraft = {
  readonly suggestion: MealSuggestion;
  readonly items: readonly MealprintDraftItem[];
  readonly slot: MealSlot;
};

/** Sum of the kept items' kcal — what the confirm button reports. */
export function sumKeptDraftKcal(items: readonly MealprintDraftItem[]): number {
  return items.reduce(
    (total, item) => (item.on ? total + item.kcal : total),
    0,
  );
}

/** Every suggestion item starts kept: the server already verified the whole composition. */
export function draftFromSuggestion(
  suggestion: MealSuggestion,
  slot: MealSlot,
): MealprintDraft {
  return {
    suggestion,
    items: suggestion.items.map((item) => ({ ...item, on: true })),
    slot,
  };
}
