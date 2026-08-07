/**
 * Mealprint (spec-26 amendment §B) — OFF category-tag → shopping-list aisle.
 *
 * Pure and synchronous, same posture as `avoidanceFilter`: no DB, no I/O, fully
 * enumerable in tests. `foods.categoryTags` is OFF's raw `categories_tags`
 * array as normalised by `offMapper.normaliseOffTags` — lowercased, trimmed,
 * NOT filtered to the `en:` prefix, so a tag can be `en:meats`, a bare
 * `meats`, or (for a curated/locale row) a different language prefix
 * entirely. Matching is therefore done with `tag.includes(fragment)` rather
 * than an exact/prefix match, so `en:meats`, `meats` and `fresh-meats` all hit
 * the same rule.
 *
 * `Other` is reserved for genuinely unmapped/unknown input: NULL/empty tags,
 * and (at the caller) a custom-name recipe ingredient with no linked food
 * row. `Cupboard` is the default for a food that HAS category tags but none
 * that match a fresher/perishable aisle below — a shelf-stable catch-all, not
 * an "unknown" signal.
 */

export const SHOPPING_AISLES = [
  "Meat & fish",
  "Dairy & eggs",
  "Fruit & veg",
  "Bakery",
  "Cupboard",
  "Other",
] as const;

export type ShoppingAisle = (typeof SHOPPING_AISLES)[number];

type MappedAisle = Exclude<ShoppingAisle, "Cupboard" | "Other">;

/**
 * Keyword fragments checked against each (already-lowercased) OFF category
 * tag with `tag.includes(fragment)`. Order matters: the first rule with any
 * matching tag wins, so a product carrying both a fresh-meat tag and an
 * unrelated frozen-foods tag still lands in `Meat & fish`.
 */
const AISLE_RULES: ReadonlyArray<{
  aisle: MappedAisle;
  fragments: readonly string[];
}> = [
  {
    aisle: "Meat & fish",
    fragments: [
      "meat",
      "poultry",
      "chicken",
      "beef",
      "pork",
      "lamb",
      "turkey",
      "bacon",
      "sausage",
      "charcuterie",
      "fish",
      "seafood",
      "salmon",
      "tuna",
      "prawn",
      "shrimp",
      "shellfish",
    ],
  },
  {
    aisle: "Dairy & eggs",
    fragments: [
      "dairy",
      "dairies",
      "milk",
      "cheese",
      "yogurt",
      "yoghurt",
      "cream",
      "butter",
      "egg",
    ],
  },
  {
    aisle: "Fruit & veg",
    fragments: [
      "fruit",
      "vegetable",
      "produce",
      "salad",
      "herb",
      "potato",
      "mushroom",
    ],
  },
  {
    aisle: "Bakery",
    fragments: [
      "bread",
      "bakery",
      "pastr",
      "bun",
      "roll",
      "baguette",
      "cake",
      "biscuit",
    ],
  },
];

function tagMatches(tag: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => tag.includes(fragment));
}

/**
 * Map one food's OFF `categoryTags` to a display aisle, in the fixed order
 * the shopping list renders them: `Meat & fish` · `Dairy & eggs` ·
 * `Fruit & veg` · `Bakery` · `Cupboard` · `Other`.
 */
export function mapCategoryTagsToAisle(
  tags: readonly string[] | null | undefined,
): ShoppingAisle {
  if (!tags || tags.length === 0) return "Other";

  const normalised = tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  if (normalised.length === 0) return "Other";

  for (const rule of AISLE_RULES) {
    if (normalised.some((tag) => tagMatches(tag, rule.fragments))) {
      return rule.aisle;
    }
  }

  return "Cupboard";
}
