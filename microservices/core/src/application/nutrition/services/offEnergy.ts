/**
 * Open Food Facts energy reconciliation shared by the bulk seed, daily delta,
 * and live barcode resolver.
 *
 * OFF can publish kcal and kJ values that contradict each other. The previous
 * mapper returned any numeric kcal value immediately, so a product reporting
 * `2.4 kcal` alongside `850.6 kJ` was persisted as 2.4 kcal. This boundary now
 * keeps the best available energy value while marking contradictory source data
 * invalid so no consumer can offer or log it.
 */

const KJ_PER_KCAL = 4.184;
const ENERGY_RELATIVE_TOLERANCE = 0.05;
const ENERGY_ABSOLUTE_TOLERANCE_KCAL = 2;
const GROSS_MACRO_FRACTION = 0.1;

export type OffNutritionDataIssue =
  | "off_quality_flag"
  | "energy_mismatch"
  | "macro_energy_mismatch";

export type OffEnergyResolution = {
  kcal: number | null;
  nutritionDataValid: boolean;
  nutritionDataIssue: OffNutritionDataIssue | null;
};

export type OffEnergyContext = {
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  qualityTags?: readonly string[] | null;
};

function finite(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function hasEnergyQualityMismatch(tags: readonly string[] | null): boolean {
  return (tags ?? []).some((tag) => {
    const normalised = tag.trim().toLowerCase();
    // Only kcal↔kJ disagreement is authoritative here. OFF's broader
    // "computed from nutrients" warning legitimately fires for fibre, alcohol,
    // polyols and rounding; the conservative macro lower-bound guard below
    // catches only the impossible cases without discarding those products.
    return normalised.includes(
      "energy-value-in-kcal-does-not-match-value-in-kj",
    );
  });
}

export function hasGrossMacroEnergyMismatch(
  kcal: number,
  context: OffEnergyContext,
): boolean {
  const protein = context.proteinG;
  const carbs = context.carbsG;
  const fat = context.fatG;
  if (
    protein == null ||
    carbs == null ||
    fat == null ||
    !Number.isFinite(protein) ||
    !Number.isFinite(carbs) ||
    !Number.isFinite(fat) ||
    protein < 0 ||
    carbs < 0 ||
    fat < 0
  ) {
    return false;
  }

  // This is deliberately only a gross lower-bound guard. Label energy need not
  // equal 4/4/9 exactly (fibre, polyols, alcohol, and rounding all matter), but
  // 1 kcal beside hundreds of kcal worth of declared macros is never credible.
  const macroEnergy = protein * 4 + carbs * 4 + fat * 9;
  return macroEnergy > 0 && kcal < macroEnergy * GROSS_MACRO_FRACTION;
}

/**
 * Reconcile OFF energy fields and return an explicit validity verdict.
 *
 * When kcal and kJ disagree, the kJ-derived value is retained for remediation
 * and audit purposes, but the row is still invalid. Callers must persist and
 * enforce `nutritionDataValid`; choosing a fallback does not make a conflicted
 * external record safe to serve.
 */
export function resolveOffEnergy(
  nutriments: Record<string, unknown> | undefined | null,
  context: OffEnergyContext = {},
): OffEnergyResolution {
  const n = nutriments ?? {};
  const rawKcal = finite(n["energy-kcal_100g"]);
  const explicitKj = finite(n["energy-kj_100g"]);
  const genericKj = finite(n["energy_100g"]);
  const rawKj = explicitKj !== null && explicitKj >= 0 ? explicitKj : genericKj;
  const malformedEnergy =
    (rawKcal !== null && rawKcal < 0) ||
    (explicitKj !== null && explicitKj < 0) ||
    (genericKj !== null && genericKj < 0);
  const kcal = rawKcal !== null && rawKcal >= 0 ? rawKcal : null;
  const kj = rawKj !== null && rawKj >= 0 ? rawKj : null;
  const kcalFromKj = kj === null ? null : round1(kj / KJ_PER_KCAL);

  if (kcal === null && kcalFromKj === null) {
    return {
      kcal: null,
      nutritionDataValid: false,
      nutritionDataIssue: null,
    };
  }

  let resolvedKcal = kcal ?? kcalFromKj!;
  let issue: OffNutritionDataIssue | null = malformedEnergy
    ? "energy_mismatch"
    : null;

  if (kcal !== null && kcalFromKj !== null) {
    const tolerance = Math.max(
      ENERGY_ABSOLUTE_TOLERANCE_KCAL,
      kcalFromKj * ENERGY_RELATIVE_TOLERANCE,
    );
    if (Math.abs(kcal - kcalFromKj) > tolerance) {
      resolvedKcal = kcalFromKj;
      issue = "energy_mismatch";
    }
  }

  if (issue === null && hasEnergyQualityMismatch(context.qualityTags ?? null)) {
    issue = "off_quality_flag";
  }

  if (issue === null && hasGrossMacroEnergyMismatch(resolvedKcal, context)) {
    issue = "macro_energy_mismatch";
  }

  return {
    kcal: resolvedKcal,
    nutritionDataValid: issue === null,
    nutritionDataIssue: issue,
  };
}

/** Energy-only compatibility helper. Prefer `resolveOffEnergy` at write paths. */
export function kcalFromOffNutriments(
  nutriments: Record<string, unknown> | undefined | null,
): number | null {
  return resolveOffEnergy(nutriments).kcal;
}
