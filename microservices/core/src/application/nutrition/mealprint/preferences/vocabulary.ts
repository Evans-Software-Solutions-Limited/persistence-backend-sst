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
/**
 * A per-token disqualifier, with its DIRECTION.
 *
 * ⚠ **Direction is a property of the ENTRY, not of the rule** — the conclusion two
 * independent review passes reached after both of my attempts at a single global
 * rule failed in opposite directions:
 *
 *   - Preceding-only re-excluded `Red Kidney Beans` from a vegan pool, because
 *     "kidney" is a SHAPE ADJECTIVE and its qualifier ("beans") is the head noun
 *     that follows it.
 *   - Either-side then cleared a pile of real products on a co-ingredient or a
 *     pack claim sitting AFTER the token: `Maliban Butter Coconut Biscuits`,
 *     `Cadbury Dairy Milk Coconut`, `Butter Almond Cake`, `Pasta Lentil Soup`,
 *     `Sliced Loaf Nut Free`.
 *
 * Every other entry is a MATERIAL relation — "rice noodles" is noodles made of
 * rice — and in English the material always precedes the head. So `before` is the
 * norm and `after` is the exception, and the type makes you say which.
 */
export interface TokenQualifier {
  /** Words that must sit immediately BEFORE the token (material modifiers). */
  before?: readonly string[];
  /** Words that must sit immediately AFTER it (head nouns — "kidney beans"). */
  after?: readonly string[];
}

export interface NameAxis {
  key: string;
  tokens: readonly string[];
  /** Negating any of these in the name clears this axis for this row. */
  negators: readonly string[];
  /**
   * OFF `categories_tags` SUBSTRINGS that indicate this axis.
   *
   * ⚠ These live ON THE AXIS rather than on the pattern rule so the free-from
   * negation covers them. A bare `tag.includes(needle)` on the rule was the
   * "Gluten Free Bread" bug reintroduced through the category channel: a
   * genuinely gluten-free loaf carries `en:breads`, a vegan cheese carries
   * `en:vegan-cheeses`, and an oat milk carries `en:oat-milks` — so the
   * substring fires on exactly the products a restricted eater shops for, and
   * it fired BEFORE the name rules, which meant the negation machinery written
   * to prevent this never ran.
   *
   * Substring rather than exact because OFF categories are deep and numerous
   * ('en:chicken-breasts', 'en:cooked-chicken', 'en:chicken-based-products')
   * and enumerating them is not tractable.
   */
  categorySubstrings: readonly string[];
  /**
   * Words that mean "this product is the WITHOUT-this-axis version", matched as a
   * whole name token OR as a substring of a category tag.
   *
   * ⚠ Distinct from {@link negators}, which needs an explicit free-from PHRASING
   * ("gluten free", "no beef", "free from wheat"). A great many free-from products
   * do not phrase it that way at all: "Vegan Cheddar Style Block" tagged
   * `en:vegan-cheeses` matches the dairy axis on "cheddar"/"cheese" and negates
   * nothing, because nowhere does it say "dairy free". Without this field the
   * category channel excludes the entire plant-based aisle from a vegan's and a
   * dairy-free user's pool — the exact shelf they shop from.
   *
   * Scoped per axis because the markers are not interchangeable: `vegan` clears
   * dairy, egg and meat, and says NOTHING about gluten (a vegan loaf is still
   * wheat).
   */
  clearedBy: readonly string[];
  /**
   * Per-token disqualifiers: `token → words that mean this token is NOT this axis`.
   *
   * ⚠ Distinct from {@link clearedBy}, and the difference matters — a marker
   * clears the WHOLE AXIS, which would be wrong here. "Almond Flour" must not
   * clear the gluten axis outright (an "Almond & Wheat Flour Blend" is still
   * wheat); it must only stop the token *flour* from counting.
   *
   * Every entry is a confirmed false positive on today's data, and all three bite
   * TODAY rather than being pre-backfill artefacts:
   *
   *   - `Red Kidney Beans` excluded from a VEGAN pool on "kidney" (the meat axis
   *     axis is applied unconditionally, so that exclusion was permanent) —
   *     and kidney beans sort near the top of a protein-density-ordered pool for
   *     exactly that user.
   *   - `Peanut Butter` excluded from a dairy-free pool on "butter".
   *   - `Almond Flour` excluded from a gluten-free pool on "flour".
   */
  tokenQualifiers?: Readonly<Record<string, TokenQualifier>>;
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
    // ⚠ Carbonara is defined by pancetta or guanciale. Added to the DAIRY axis a
    // commit earlier and nowhere else, which left a vegetarian (and a halal user)
    // being served `Spaghetti Carbonara` while a dairy-free user was not.
    "carbonara",
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
    // Forms and trade names that contain no generic word: "Fishermans Pie"
    // tokenises to ["fisherman","pie"] and matched nothing.
    "fisherman",
    "scampi",
    "kipper",
    "whitebait",
    "surimi",
    "roe",
    // Restored with a qualifier — see the seafood axis' `tokenQualifiers`.
    "caviar",
    "taramasalata",
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
    // Butter- and cheese-enriched products whose names contain no generic dairy
    // word. Found while closing the `en:plant-based-foods` marker regression:
    // once the marker stopped wrongly clearing them, `Brioche Loaf` and
    // `Green Pesto` were still allowed for a vegan because NOTHING matched. The
    // free-from guards still cover the plant-based versions by name marker
    // ("Vegan Pesto") or explicit phrasing.
    "brioche",
    "croissant",
    "pesto",
    // Butter + condensed milk. The earlier `Cocoa Butter Fudge` finding was
    // pointing at the right product for the wrong reason: the dairy is the FUDGE,
    // not the cocoa butter, so no `butter` qualifier change could ever fix it.
    "fudge",
    "carbonara",
    "alfredo",
    "tiramisu",
    "cheesecake",
  ],
  egg: [
    "egg",
    "omelette",
    "omelet",
    "mayonnaise",
    "meringue",
    // "Deep Filled Quiche" contains no generic egg word.
    "quiche",
    "frittata",
    "pavlova",
  ],
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
    // ⚠ Bread and pasta FORMS. Added because the generic words alone missed
    // ordinary products outright: "Sourdough Loaf" contains neither "bread" nor
    // "wheat", so a gluten-free user was offered it whenever its category tags
    // were absent — which is every row until the OFF re-seed lands.
    "loaf",
    "sourdough",
    "baguette",
    "ciabatta",
    "focaccia",
    "brioche",
    "bagel",
    "crumpet",
    "muffin",
    "scone",
    "croissant",
    "naan",
    "chapati",
    "pitta",
    "pita",
    "tortilla",
    "noodle",
    "macaroni",
    "spaghetti",
    "penne",
    "fusilli",
    "tagliatelle",
    "lasagne",
    "lasagna",
    "ravioli",
    "gnocchi",
    "doughnut",
    "donut",
    "waffle",
    "pancake",
    // ⚠ "battered", not "batter". `singularise` only ever SHORTENS, so
    // "battered" never reduces to "batter" — the token caught "Batter Mix" and
    // MISSED "Battered Onion Rings", i.e. the form it was added for. A test
    // written around the former would have pinned a rule that does not cover the
    // real case.
    "batter",
    "battered",
    // Restored with qualifiers — see this axis' `tokenQualifiers`. Deleting them
    // outright served Pork Pie and Chicken Caesar Wrap to a gluten-free user.
    "pie",
    "wrap",
    // ⚠ "pie" and "wrap" were REMOVED, not qualified. Cottage, shepherd's and
    // fish pie are potato-topped with no pastry, and "Lettuce Wraps" is the
    // canonical gluten-free substitute — both are standard gluten-free food, and
    // no adjacency list makes either token safe. `pasty` and `quiche` stay
    // (always pastry).
    "pasty",
    "quiche",
  ],
  pork: [
    "carbonara",
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
    tokens: [...NAME_TOKENS.meat],
    tokenQualifiers: {
      // ⚠ The ONE after-only entry in the file. "Red Kidney Beans" is not offal,
      // and "kidney" is a shape adjective whose qualifier is the head noun that
      // FOLLOWS it — the opposite of every material qualifier below.
      kidney: { after: ["bean", "beans"] },
      // ⚠ No `liver` entry. An earlier draft had one "for symmetry of intent" —
      // a rule that cannot fire, which is worse than none in a dangerous-area
      // file because it reads as coverage.
    },
    negators: ["meat"],
    categorySubstrings: ["meat", "poultry", "charcuterie"],
    clearedBy: ["vegan", "vegetarian", "plantbased", "substitute", "analogue"],
  },
  // ⚠ Honey is its OWN axis and belongs to `vegan` ALONE. It was folded into the
  // meat axis at first "because it is only ever relevant to vegan" — but the meat
  // axis is shared by vegetarian and pescatarian, who eat honey, so that sharing
  // denied it to both. Adding `honey` to the meat axis' CATEGORY substrings made
  // it worse: `en:honeys` then excluded honey from a vegetarian's pool on a row
  // whose name never says "honey".
  honey: {
    key: "honey",
    tokens: ["honey"],
    negators: ["honey"],
    categorySubstrings: ["honey"],
    clearedBy: ["vegan"],
  },
  seafood: {
    key: "seafood",
    tokens: [...NAME_TOKENS.seafood],
    tokenQualifiers: {
      // "Aubergine Caviar" / "Mushroom Caviar" are vegetable dips.
      caviar: { before: ["aubergine", "eggplant", "mushroom"] },
    },
    negators: ["fish", "seafood"],
    categorySubstrings: ["fish", "seafood"],
    clearedBy: ["vegan", "vegetarian", "plantbased"],
  },
  shellfish: {
    key: "shellfish",
    tokens: [...NAME_TOKENS.shellfish],
    negators: ["shellfish"],
    categorySubstrings: ["shellfish", "crustacean", "mollusc"],
    clearedBy: ["vegan", "vegetarian", "plantbased"],
  },
  dairy: {
    key: "dairy",
    tokens: [...NAME_TOKENS.dairy],
    // "Dairy-Free Oat Milk" — the case that forced axis-level negation.
    negators: ["dairy", "milk", "lactose"],
    categorySubstrings: ["dairy", "cheese", "yogurt", "yoghurt", "milk"],
    clearedBy: ["vegan", "plantbased", "nondairy", "lactosefree"],
    tokenQualifiers: {
      // Nut, seed and fruit butters are not dairy. "Peanut Butter" excluded from
      // a dairy-free pool was a confirmed false positive.
      butter: {
        before: [
          "peanut",
          "almond",
          "cashew",
          "hazelnut",
          "pistachio",
          "walnut",
          "nut",
          "seed",
          "sesame",
          "tahini",
          "coconut",
          "cocoa",
          "shea",
          "apple",
        ],
      },
      // ⚠ "tomato" is deliberately ABSENT. Heinz Cream of Tomato contains milk,
      // and "cream of tomato" is exactly the adjacency an adjacency rule honours —
      // so no version of this qualifier is safe. It removed a true positive by
      // construction rather than by collision.
      cream: { before: ["coconut", "oat", "soya", "soy", "almond"] },
      // ⚠ Plant milks. This carries real weight now that the name channel is
      // unconditional: without it "Alpro Soya Chocolate Milk Drink" is excluded
      // from a dairy-free pool on "milk" — the exact shelf that user shops from.
      // A QUALIFIER rather than a `clearedBy` marker so "Soya Milk & Butter
      // Blend" is still caught on "butter".
      milk: {
        before: [
          "soya",
          "soy",
          "oat",
          "almond",
          "coconut",
          "rice",
          "hemp",
          "cashew",
          "hazelnut",
          "pea",
          "plant",
        ],
      },
    },
  },
  egg: {
    key: "egg",
    tokens: [...NAME_TOKENS.egg],
    negators: ["egg"],
    categorySubstrings: ["egg"],
    clearedBy: ["vegan", "plantbased"],
  },
  gluten: {
    key: "gluten",
    tokens: [...NAME_TOKENS.gluten],
    // "Gluten Free Bread", "Wheat-free pasta".
    negators: ["gluten", "wheat"],
    // ⚠ NOT `vegan` — a vegan loaf is still made of wheat.
    // ⚠ `pastr`, not `pastry`: OFF's tag is `en:pastries`, which does not contain
    // the string "pastry", so the rule never fired. The siblings are fine
    // ("bread" ⊂ en:breads, "cake" ⊂ en:cakes, "biscuit" ⊂ en:biscuits,
    // "pasta" ⊂ en:pastas).
    categorySubstrings: ["bread", "pasta", "biscuit", "cake", "pastr"],
    clearedBy: ["glutenfree", "freefrom"],
    tokenQualifiers: {
      // Naturally gluten-free flours. ⚠ A QUALIFIER, not a `clearedBy` marker:
      // "Almond & Wheat Flour Blend" must still be caught on "wheat", which an
      // axis-clearing marker would have let through.
      flour: {
        before: [
          "almond",
          "coconut",
          "rice",
          "chickpea",
          "gram",
          "corn",
          "potato",
          "tapioca",
          "buckwheat",
          "quinoa",
          "cassava",
          "soya",
          "soy",
          "nut",
        ],
      },
      // "Rice pasta", "corn pasta", "buckwheat noodles".
      pasta: {
        before: ["rice", "corn", "lentil", "chickpea", "buckwheat", "quinoa"],
      },
      // Rice noodles are the single biggest gluten-free staple in this list, and
      // the `pasta` qualifiers were not extended to `noodle` at first.
      noodle: {
        before: ["rice", "corn", "buckwheat", "soba", "mung", "glass", "kelp"],
      },
      tortilla: { before: ["corn", "maize"] },
      // ⚠ RESTORED with qualifiers, having been deleted a commit earlier. Removing
      // the token outright meant `Melton Mowbray Pork Pie`, `Steak and Kidney Pie`
      // and `Chicken Caesar Wrap` were served to a gluten-free user — a false
      // NEGATIVE, which is worse than the pool cost that motivated the deletion.
      // "No adjacency list makes these safe" was true under set membership and is
      // false under directional qualifiers.
      pie: { before: ["cottage", "shepherd", "fisherman", "fish"] },
      wrap: { before: ["lettuce", "cabbage", "collard"] },
      // ⚠ "nut" is deliberately ABSENT. "Nut Loaf" is a gluten-free vegan main but
      // "Banana Nut Loaf" and "Date & Nut Loaf" are wheat quick-breads, and the
      // wheat sense is far commoner in a UK catalogue — so the qualifier created a
      // false negative that `a389968e` did not have. Same reasoning as
      // `cream: ["tomato"]`: when no direction is safe, the entry goes.
      loaf: { before: ["lentil", "chickpea"] },
      // "Rice bread", "corn bread" are not wheat products.
      bread: { before: ["rice", "corn"] },
    },
  },
  pork: {
    key: "pork",
    tokens: [...NAME_TOKENS.pork],
    negators: ["pork"],
    categorySubstrings: ["pork", "ham", "bacon"],
    clearedBy: ["vegan", "vegetarian", "plantbased", "halal", "substitute"],
  },
  alcohol: {
    key: "alcohol",
    tokens: [...NAME_TOKENS.alcohol],
    // "Alcohol Free Lager" is a halal-compatible product.
    negators: ["alcohol"],
    categorySubstrings: ["alcoholic", "beers", "wines"],
    clearedBy: ["alcoholfree", "nonalcoholic", "dealcoholised"],
  },
} as const;

// ── Pattern rules ───────────────────────────────────────────────────────────

export interface DietaryPatternRule {
  /** OFF `allergens_tags` values whose presence violates the pattern. */
  allergenTags: readonly string[];
  /**
   * Name axes this pattern forbids, matched as whole singularised NAME TOKENS and
   * as CATEGORY-TAG substrings.
   *
   * ⚠ **ONE list, applied UNCONDITIONALLY.** This used to be two —
   * `nameAxesAlways` for axes no allergen tag represents (meat, pork, alcohol)
   * and `nameAxesWhenUntagged` for axes a tag could speak to (dairy, gluten,
   * seafood, egg) — with the second gated on the row's tag state. That gate
   * leaked in three successive shapes (`allergenTags === null`, then `tagsUsable`,
   * then "did the row make a complete `[]` claim") and has been removed: an
   * allergen tag's SILENCE is not evidence about an axis it was never about, so
   * no version of the gate could be right. See `assessAvoidance` § 2c.
   *
   * False positives are prevented by POSITIVE evidence instead —
   * {@link NameAxis.negators}, {@link NameAxis.clearedBy} and
   * {@link NameAxis.tokenQualifiers} — which is what keeps "Gluten Free Bread",
   * "Vegan Cheddar", "Peanut Butter" and "Soya Milk" in the pools they belong in.
   */
  nameAxes: readonly NameAxis[];
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
    nameAxes: [NAME_AXES.meat, NAME_AXES.seafood, NAME_AXES.shellfish],
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
    nameAxes: [
      NAME_AXES.meat,
      NAME_AXES.honey,
      NAME_AXES.seafood,
      NAME_AXES.shellfish,
      NAME_AXES.dairy,
      NAME_AXES.egg,
    ],
    partialEnforcementOnly: false,
  },
  pescatarian: {
    // Fish and shellfish are permitted, so only land meat is excluded — and meat
    // has no allergen tag, so every token is in the always-applied list.
    allergenTags: [],
    nameAxes: [NAME_AXES.meat],
    partialEnforcementOnly: false,
  },
  halal: {
    allergenTags: [],
    nameAxes: [NAME_AXES.pork, NAME_AXES.alcohol],
    // ⚠ Certification is not in the data — see the field docstring.
    partialEnforcementOnly: true,
  },
  kosher: {
    allergenTags: [
      ...ALLERGEN_OFF_TAGS.crustaceans,
      ...ALLERGEN_OFF_TAGS.molluscs,
    ],
    // ⚠ The SHELLFISH axis only, NOT the whole seafood axis. Fin fish with
    // scales is kosher — excluding salmon and cod would be plainly wrong, and an
    // earlier draft of this rule did exactly that by reusing the seafood list.
    nameAxes: [NAME_AXES.pork, NAME_AXES.shellfish],
    // ⚠ Certification is not in the data — see the field docstring.
    partialEnforcementOnly: true,
  },
  dairy_free: {
    allergenTags: [...ALLERGEN_OFF_TAGS.milk],
    nameAxes: [NAME_AXES.dairy],
    partialEnforcementOnly: false,
  },
  gluten_free: {
    allergenTags: [...ALLERGEN_OFF_TAGS.gluten],
    nameAxes: [NAME_AXES.gluten],
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
  // "free from <token>" / "without <token>" / "no <token>".
  //
  // ⚠ AT MOST ONE intervening word, deliberately. A 20-CHARACTER gap (the first
  // cut) matched "No Added Sugar Milkshake" — "no" + " added sugar " + "milk" —
  // and so cleared the whole DAIRY axis for a dairy-free user on a product that
  // is plain cow's milk. Same for "No Added Sugar Wheat Biscuits" and the gluten
  // axis. A negation that reaches across two unrelated words is not a negation of
  // the token; "free from wheat" and "no beef" are adjacent, which is the shape
  // that actually appears on packaging.
  return new RegExp(
    `\\b(?:free from|without|no)\\b(?: [a-z0-9-]+)?[ -]${escaped}\\b`,
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
