/**
 * Mealprint (spec-26) — the closed vocabularies every preference write is
 * validated against, and the OFF-tag / name-token rules `avoidanceFilter`
 * interprets them with.
 *
 * ⚠ **This file and
 * `supabase/migrations/20260803120100_nutrition_preferences.sql` must agree.**
 * The migration's CHECK constraints list the same pattern and allergen keys. The
 * duplication is deliberate — the handler check names the offending value in a
 * 400 (the useful error), the DB constraint is the backstop that stops an
 * unrecognised value being stored by ANY write path. An unrecognised pattern
 * would be silently ignored at generation time, i.e. a user who chose "vegan"
 * gets meat, which is the failure both layers exist to prevent. If you add a key
 * here, add it there, and add its rule to {@link DIETARY_PATTERN_RULES} — a key
 * with no rule is exactly the silent no-op described above.
 */

// ── Dietary patterns ────────────────────────────────────────────────────────

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

const DIETARY_PATTERN_SET: ReadonlySet<string> = new Set(DIETARY_PATTERNS);

export function isDietaryPattern(value: string): value is DietaryPattern {
  return DIETARY_PATTERN_SET.has(value);
}

// ── Allergens (UK FIC 14 — Brad signed off the chip set 2026-07-24) ─────────

/**
 * The 14 allergens UK food-information law requires to be declared. This is the
 * CEILING of the avoid-allergen vocabulary (requirements AC 1.1) — anything
 * outside it belongs in `avoid_foods` as a dislike, which is filtered by name
 * and carries no safety claim.
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

const ALLERGEN_SET: ReadonlySet<string> = new Set(AVOID_ALLERGENS);

export function isAllergenKey(value: string): value is AllergenKey {
  return ALLERGEN_SET.has(value);
}

/**
 * Allergen key → the OFF `allergens_tags` values that mean it.
 *
 * Several keys carry MORE than one tag because OFF's taxonomy has parallel
 * canonical entries and its data is not perfectly canonicalised (`en:nuts` and
 * `en:tree-nuts` both occur; sulphites appear both spelled out and abbreviated).
 * Listing every variant is the cheap direction to be thorough in: a missing
 * variant is a false NEGATIVE on an allergen, which is the one error class this
 * whole module exists to avoid.
 *
 * ⚠ `nuts` deliberately does NOT include `en:peanuts`. A peanut is a legume, the
 * two are separately regulated, and OFF tags them separately — folding them
 * together would silently deny tree-nut avoiders every peanut product and
 * misreport the reason. A user who avoids both selects both chips.
 */
export const ALLERGEN_OFF_TAGS: Readonly<
  Record<AllergenKey, readonly string[]>
> = {
  celery: ["en:celery", "en:celeriac"],
  gluten: [
    "en:gluten",
    "en:cereals-containing-gluten",
    "en:wheat",
    "en:barley",
    "en:rye",
    "en:oats",
    "en:spelt",
    "en:kamut",
  ],
  crustaceans: ["en:crustaceans"],
  eggs: ["en:eggs", "en:egg"],
  fish: ["en:fish"],
  lupin: ["en:lupin"],
  milk: ["en:milk", "en:lactose"],
  molluscs: ["en:molluscs", "en:mollusks"],
  mustard: ["en:mustard"],
  nuts: [
    "en:nuts",
    "en:tree-nuts",
    "en:almonds",
    "en:hazelnuts",
    "en:walnuts",
    "en:cashew-nuts",
    "en:cashew",
    "en:pecan-nuts",
    "en:brazil-nuts",
    "en:pistachio-nuts",
    "en:macadamia-nuts",
  ],
  peanuts: ["en:peanuts", "en:peanut"],
  sesame: ["en:sesame-seeds", "en:sesame"],
  soybeans: ["en:soybeans", "en:soy", "en:soya"],
  sulphites: [
    "en:sulphur-dioxide-and-sulphites",
    "en:sulphites",
    "en:sulfites",
    "en:sulphur-dioxide",
  ],
};

// ── Effort ──────────────────────────────────────────────────────────────────

export const EFFORT_LEVELS = ["quick", "balanced", "high_maintenance"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
const EFFORT_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);
export function isEffortLevel(value: string): value is EffortLevel {
  return EFFORT_SET.has(value);
}

// ── Locale ──────────────────────────────────────────────────────────────────

/** v1 ships en-GB only (locked decision 5); the column exists so adding one is data. */
export const SUPPORTED_LOCALES = ["en-GB"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const LOCALE_SET: ReadonlySet<string> = new Set(SUPPORTED_LOCALES);
export function isSupportedLocale(value: string): value is SupportedLocale {
  return LOCALE_SET.has(value);
}

/** The OFF `countries_tags` value a locale's curated catalogue is drawn from. */
export const LOCALE_OFF_TAG: Readonly<Record<SupportedLocale, string>> = {
  "en-GB": "en:united-kingdom",
};

// ── Name axes (the heuristic channel) ───────────────────────────────────────

/**
 * A named INGREDIENT CLASS, with the tokens that indicate it and the words whose
 * negation clears the whole class.
 *
 * ⚠ **The `negators` field is what makes free-from products work, and it has to
 * be per-AXIS rather than per-token.** "Dairy-Free Oat Milk" matches the dairy
 * axis on the token "milk", but the negation in the name is on the word
 * *dairy* — so checking only whether the MATCHED token is negated leaves the
 * product excluded from a dairy-free user's pool, which is the shelf they
 * actually shop from. Conversely the negation must not be axis-blind: "Dairy
 * Free Chicken Nuggets" negates dairy and says nothing about meat, so a vegan
 * must still not be offered it. Scoping negation to the axis gets both right;
 * a global "is anything negated in this name" check gets the second one wrong.
 */
export interface NameAxis {
  key: string;
  tokens: readonly string[];
  /** Negating any of these in the name clears this axis for this row. */
  negators: readonly string[];
}

/**
 * Whole-word tokens that indicate an ingredient class by NAME.
 *
 * ⚠ **These are heuristics and are documented as such wherever a verdict cites
 * them.** They exist because a user's OWN foods and recipes have no OFF tags and
 * never will, so a tag-only pattern filter would either ignore them (a vegan
 * offered their flatmate's chicken recipe) or exclude everything they ever
 * created. Matching is on whole SINGULARISED TOKENS, never substrings — so
 * "egg" does not match "eggplant" and "nut" does not match "nutmeg", which is
 * the failure mode a naive `includes()` has.
 *
 * They are NOT used for allergen avoidance. An allergen verdict is tag-derived
 * only; a row without interpretable tags is excluded outright rather than
 * cleared by a word list (see `avoidanceFilter`).
 */
export const NAME_TOKENS = {
  meat: [
    "meat",
    "chicken",
    "beef",
    "pork",
    "bacon",
    "ham",
    "gammon",
    "lamb",
    "mutton",
    "turkey",
    "duck",
    "veal",
    "venison",
    "sausage",
    "salami",
    "chorizo",
    "pepperoni",
    "prosciutto",
    "pancetta",
    "lard",
    "gelatine",
    "gelatin",
    "mince",
    "steak",
    "meatball",
    "liver",
    "kidney",
    "brisket",
    "ribeye",
  ],
  seafood: [
    "fish",
    "seafood",
    "salmon",
    "tuna",
    "cod",
    "haddock",
    "pollock",
    "prawn",
    "shrimp",
    "crab",
    "lobster",
    "crayfish",
    "mussel",
    "oyster",
    "clam",
    "squid",
    "calamari",
    "octopus",
    "scallop",
    "anchovy",
    "anchovies",
    "sardine",
    "mackerel",
    "herring",
    "trout",
    "seabass",
  ],
  dairy: [
    "milk",
    "cheese",
    "butter",
    "cream",
    "yoghurt",
    "yogurt",
    "whey",
    "casein",
    "ghee",
    "custard",
    "mozzarella",
    "cheddar",
    "parmesan",
    "halloumi",
    "mascarpone",
    "ricotta",
  ],
  egg: ["egg", "omelette", "omelet", "mayonnaise", "meringue"],
  gluten: [
    "gluten",
    "wheat",
    "barley",
    "rye",
    "spelt",
    "semolina",
    "couscous",
    "bulgur",
    "bread",
    "pasta",
    "flour",
    "breadcrumb",
    "cracker",
    "pastry",
  ],
  pork: [
    "pork",
    "bacon",
    "ham",
    "gammon",
    "lard",
    "gelatine",
    "gelatin",
    "prosciutto",
    "pancetta",
    "chorizo",
    "pepperoni",
    "salami",
  ],
  alcohol: [
    "beer",
    "wine",
    "lager",
    "ale",
    "cider",
    "vodka",
    "whisky",
    "whiskey",
    "rum",
    "gin",
    "brandy",
    "liqueur",
    "prosecco",
    "champagne",
    "sherry",
    "port",
  ],
  shellfish: [
    "shellfish",
    "prawn",
    "shrimp",
    "crab",
    "lobster",
    "crayfish",
    "mussel",
    "oyster",
    "clam",
    "squid",
    "calamari",
    "octopus",
    "scallop",
  ],
} as const;

/**
 * The axes, each pairing its token list with the words that clear it.
 *
 * `honey` is folded into the meat axis' token list rather than getting an axis
 * of its own: it is only ever relevant to `vegan`, and "honey free" is not a
 * phrasing that appears on packaging.
 */
export const NAME_AXES: Readonly<Record<string, NameAxis>> = {
  meat: {
    key: "meat",
    tokens: [...NAME_TOKENS.meat, "honey"],
    negators: ["meat"],
  },
  seafood: {
    key: "seafood",
    tokens: [...NAME_TOKENS.seafood],
    negators: ["fish", "seafood"],
  },
  shellfish: {
    key: "shellfish",
    tokens: [...NAME_TOKENS.shellfish],
    negators: ["shellfish"],
  },
  dairy: {
    key: "dairy",
    tokens: [...NAME_TOKENS.dairy],
    // "Dairy-Free Oat Milk" — the case that forced axis-level negation.
    negators: ["dairy", "milk", "lactose"],
  },
  egg: {
    key: "egg",
    tokens: [...NAME_TOKENS.egg],
    negators: ["egg"],
  },
  gluten: {
    key: "gluten",
    tokens: [...NAME_TOKENS.gluten],
    // "Gluten Free Bread", "Wheat-free pasta".
    negators: ["gluten", "wheat"],
  },
  pork: {
    key: "pork",
    tokens: [...NAME_TOKENS.pork],
    negators: ["pork"],
  },
  alcohol: {
    key: "alcohol",
    tokens: [...NAME_TOKENS.alcohol],
    // "Alcohol Free Lager" is a halal-compatible product.
    negators: ["alcohol"],
  },
} as const;

// ── Pattern rules ───────────────────────────────────────────────────────────

export interface DietaryPatternRule {
  /** OFF `allergens_tags` values whose presence violates the pattern. */
  allergenTags: readonly string[];
  /**
   * OFF `categories_tags` SUBSTRINGS whose presence violates the pattern.
   * Substring rather than exact because OFF categories are deep and numerous
   * ('en:chicken-breasts', 'en:cooked-chicken', 'en:chicken-based-products'),
   * and enumerating them is not tractable. Matched against the whole tag string.
   */
  categoryTagSubstrings: readonly string[];
  /**
   * Name axes an OFF **allergen tag can represent** — dairy, egg, gluten,
   * seafood, shellfish.
   *
   * ⚠ Applied ONLY when the row's `allergenTags` are absent, because where they
   * are present they are strictly better evidence than the name. Running these
   * unconditionally is the bug that excludes **"Gluten Free Bread"** from a
   * gluten-free user's pool on the token "bread".
   */
  nameAxesWhenUntagged: readonly NameAxis[];
  /**
   * Name axes NO allergen tag represents — meat, pork, alcohol. Applied ALWAYS.
   *
   * ⚠ These cannot be gated on tag presence the way the list above is. An OFF
   * row can carry `allergen_tags = []` (analysed, no regulated allergen — true
   * of plain chicken breast) and still have patchy or absent `categories_tags`,
   * so gating on tag presence would hand a vegan chicken. Meat has no allergen
   * tag to be caught by, so the name is the last line here, not a fallback.
   */
  nameAxesAlways: readonly NameAxis[];
  /**
   * ⚠ TRUE when the pattern CANNOT be fully enforced from available data, so the
   * caller must say so rather than implying certification.
   *
   * `halal` and `kosher` are the two: neither certification appears anywhere in
   * OFF, and no amount of ingredient inference substitutes for it. What is
   * enforced is the determinable subset — pork and alcohol (plus shellfish for
   * kosher) — and nothing more. Claiming otherwise would be a compliance
   * statement we have no basis for, on a feature whose stated scope is
   * lifestyle, not prescription (locked decision 10).
   */
  partialEnforcementOnly: boolean;
}

export const DIETARY_PATTERN_RULES: Readonly<
  Record<DietaryPattern, DietaryPatternRule>
> = {
  vegetarian: {
    allergenTags: [
      ...ALLERGEN_OFF_TAGS.fish,
      ...ALLERGEN_OFF_TAGS.crustaceans,
      ...ALLERGEN_OFF_TAGS.molluscs,
    ],
    categoryTagSubstrings: [
      "meat",
      "poultry",
      "fish",
      "seafood",
      "charcuterie",
    ],
    nameAxesWhenUntagged: [NAME_AXES.seafood, NAME_AXES.shellfish],
    nameAxesAlways: [NAME_AXES.meat],
    partialEnforcementOnly: false,
  },
  vegan: {
    allergenTags: [
      ...ALLERGEN_OFF_TAGS.fish,
      ...ALLERGEN_OFF_TAGS.crustaceans,
      ...ALLERGEN_OFF_TAGS.molluscs,
      ...ALLERGEN_OFF_TAGS.milk,
      ...ALLERGEN_OFF_TAGS.eggs,
    ],
    categoryTagSubstrings: [
      "meat",
      "poultry",
      "fish",
      "seafood",
      "charcuterie",
      "dairy",
      "cheese",
      "yogurt",
      "yoghurt",
      "egg",
      "honey",
    ],
    nameAxesWhenUntagged: [
      NAME_AXES.seafood,
      NAME_AXES.shellfish,
      NAME_AXES.dairy,
      NAME_AXES.egg,
    ],
    nameAxesAlways: [NAME_AXES.meat],
    partialEnforcementOnly: false,
  },
  pescatarian: {
    // Fish and shellfish are permitted, so only land meat is excluded — and meat
    // has no allergen tag, so every token is in the always-applied list.
    allergenTags: [],
    categoryTagSubstrings: ["meat", "poultry", "charcuterie"],
    nameAxesWhenUntagged: [],
    nameAxesAlways: [NAME_AXES.meat],
    partialEnforcementOnly: false,
  },
  halal: {
    allergenTags: [],
    categoryTagSubstrings: [
      "pork",
      "ham",
      "bacon",
      "alcoholic",
      "beers",
      "wines",
    ],
    nameAxesWhenUntagged: [],
    nameAxesAlways: [NAME_AXES.pork, NAME_AXES.alcohol],
    // ⚠ Certification is not in the data — see the field docstring.
    partialEnforcementOnly: true,
  },
  kosher: {
    allergenTags: [
      ...ALLERGEN_OFF_TAGS.crustaceans,
      ...ALLERGEN_OFF_TAGS.molluscs,
    ],
    categoryTagSubstrings: [
      "pork",
      "ham",
      "bacon",
      "shellfish",
      "crustacean",
      "mollusc",
    ],
    // ⚠ The SHELLFISH axis only, NOT the whole seafood axis. Fin fish with
    // scales is kosher — excluding salmon and cod would be plainly wrong, and an
    // earlier draft of this rule did exactly that by reusing the seafood list.
    nameAxesWhenUntagged: [NAME_AXES.shellfish],
    nameAxesAlways: [NAME_AXES.pork],
    // ⚠ Certification is not in the data — see the field docstring.
    partialEnforcementOnly: true,
  },
  dairy_free: {
    allergenTags: [...ALLERGEN_OFF_TAGS.milk],
    categoryTagSubstrings: ["dairy", "cheese", "yogurt", "yoghurt", "milk"],
    nameAxesWhenUntagged: [NAME_AXES.dairy],
    nameAxesAlways: [],
    partialEnforcementOnly: false,
  },
  gluten_free: {
    allergenTags: [...ALLERGEN_OFF_TAGS.gluten],
    categoryTagSubstrings: ["bread", "pasta", "biscuit", "cake", "pastry"],
    nameAxesWhenUntagged: [NAME_AXES.gluten],
    nameAxesAlways: [],
    partialEnforcementOnly: false,
  },
};

// ── "Free from" negation ────────────────────────────────────────────────────

/**
 * Is `token` NEGATED in `name` — i.e. does the name assert the ABSENCE of the
 * thing the token names?
 *
 * "Gluten Free Bread", "Dairy-free milk", "Free from wheat pasta" and "No Beef
 * Strips" all describe products the corresponding user WANTS. Without this
 * guard, the name rules exclude precisely the free-from range a restricted eater
 * shops from. Callers apply this per {@link NameAxis} rather than per token —
 * see that type's docstring for why the scoping matters in both directions.
 *
 * ⚠ Order matters and is load-bearing: the negator must appear BEFORE the token
 * ("no bones" after "chicken" in "Roast chicken, no bones" must NOT clear the
 * chicken). The gap is bounded so the negation cannot reach across a long
 * compound name and clear an unrelated ingredient.
 *
 * ⚠ Never consulted on the ALLERGEN path. A product claiming "nut free" in its
 * name is not evidence for an allergy-grade decision — that path is tag-derived
 * and fails closed, deliberately.
 */
export function isTokenNegatedInName(name: string, token: string): boolean {
  const normalised = normaliseFoodText(name);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "<token> free" / "<token>-free" (hyphens are normalised to spaces? no —
  // normaliseFoodText keeps them, so allow either separator explicitly).
  if (new RegExp(`\\b${escaped}s?[ -]free\\b`, "u").test(normalised))
    return true;
  // "free from <token>" / "without <token>" / "no <token>", bounded gap.
  return new RegExp(
    `\\b(?:free from|without|no)\\b[a-z0-9 ,-]{0,20}?\\b${escaped}`,
    "u",
  ).test(normalised);
}

// ── Normalisation ───────────────────────────────────────────────────────────

/**
 * The prefix STORY-007's "hard to find near me" uses when appending to
 * `avoid_foods`. Kept out of every piece of UI copy — it is a provenance marker
 * for the curation backlog, not something a user should ever read.
 */
export const HARD_TO_FIND_PREFIX = "hardtofind:";

/**
 * Canonicalise a free-text food name for comparison: strip accents, lowercase,
 * collapse whitespace. Applied on WRITE (so the stored dislike is already
 * canonical) and on READ of a candidate name, so matching is a comparison rather
 * than a guess.
 */
export function normaliseFoodText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Crude English singulariser — enough for ingredient nouns, and deliberately
 * conservative: it only ever SHORTENS, so it cannot invent a token.
 *
 * Not a linguistics library. "olives"→"olive", "berries"→"berry",
 * "tomatoes"→"tomato". Irregulars ("leaves"→"leafe") are wrong but harmless: the
 * same function runs on both sides of every comparison, so a consistent wrong
 * answer still matches itself.
 */
export function singularise(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (/(?:ch|sh|s|x|z)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith("oes")) return token.slice(0, -2);
  if (token.endsWith("ss")) return token;
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/**
 * Split a name into comparable whole-word tokens. Non-alphanumeric characters
 * are separators, so "chicken-breast (skinless)" → ["chicken","breast","skinless"].
 *
 * Tokenising rather than substring-matching is what stops "egg" matching
 * "eggplant" and "nut" matching "nutmeg" — the classic over-match in this kind
 * of filter, and one that would silently deny a user foods they can eat.
 */
export function tokeniseFoodName(raw: string): string[] {
  return normaliseFoodText(raw)
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0)
    .map(singularise);
}
