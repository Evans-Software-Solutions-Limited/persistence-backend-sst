/**
 * Ingredient-quantity → food-serving scaling for recipe macro totals.
 *
 * A recipe ingredient states a quantity + unit (e.g. `200 g`, `0.5 kg`,
 * `2 cups`) and links to a `foods` row that carries its macros per
 * `servingSize` of `servingUnit` (e.g. per `100 g`). To sum macros we need
 * the factor "how many of the food's servings does this ingredient represent".
 *
 * MASS units (g, kg, oz, lb) convert to a common base (grams) exactly, so an
 * ingredient in kg/oz/lb against a gram-based food scales correctly — the case
 * the naive `quantity / servingSize` got catastrophically wrong (it treated
 * `0.5 kg` as `0.5 g`). VOLUME (ml, cups, tbsp…) and COUNT (piece, slice…)
 * units are NOT converted here: ml→g needs per-ingredient density and counts
 * need per-item weight, neither of which we hold. For those — and for a bare
 * unitless quantity or a unit that already matches the food's serving unit —
 * we fall back to `quantity / servingSize` (i.e. "quantity servings of the
 * food"), preserving prior behaviour. The whole-recipe AI estimate is the
 * escape hatch for imports whose ingredient units we can't reconcile.
 */

/** Grams per unit for the mass units we convert exactly. */
const MASS_UNIT_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  gs: 1,
  kg: 1000,
  kgs: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.349523125,
  ounce: 28.349523125,
  ounces: 28.349523125,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
  pounds: 453.59237,
};

function normaliseUnit(unit: string | null | undefined): string {
  if (typeof unit !== "string") return "";
  return unit.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Convert a mass quantity to grams, or null when the unit isn't a mass unit we
 * recognise (empty/absent, volume, count, or unknown → null).
 */
export function toGrams(
  quantity: number,
  unit: string | null | undefined,
): number | null {
  const factor = MASS_UNIT_GRAMS[normaliseUnit(unit)];
  return factor === undefined ? null : quantity * factor;
}

/**
 * The multiplier applied to a food's per-serving macros for one ingredient.
 * Returns 0 for a non-positive serving size (guards divide-by-zero). Prefers
 * exact gram-based scaling when BOTH the ingredient and the food serving are
 * mass units; otherwise falls back to `quantity / servingSize`.
 */
export function servingScaleFactor(
  ingQuantity: number,
  ingUnit: string | null | undefined,
  foodServingSize: number,
  foodServingUnit: string | null | undefined,
): number {
  if (foodServingSize <= 0) return 0;

  const ingGrams = toGrams(ingQuantity, ingUnit);
  const servingGrams = toGrams(foodServingSize, foodServingUnit);
  if (ingGrams !== null && servingGrams !== null && servingGrams > 0) {
    return ingGrams / servingGrams;
  }

  return ingQuantity / foodServingSize;
}
