/**
 * Open Food Facts energy → kcal, with a kilojoule fallback. Shared by the live
 * barcode resolver (`barcode/services/openFoodFacts.ts`) and the seed/delta
 * mapper (`offMapper.ts`) so both agree on how energy is derived.
 *
 * OFF's canonical field is `energy-kcal_100g`. Many products — especially EU
 * ones — publish energy ONLY in kilojoules (`energy-kj_100g`, or the generic
 * `energy_100g`, which is kJ by OFF convention). Reading kcal alone made those
 * resolve to null → "barcode_not_found" even though OFF has the product. Fall
 * back to kJ ÷ 4.184 (kJ per kcal) so kJ-only products resolve.
 *
 * Returns null only when NO usable energy figure is present.
 */

const KJ_PER_KCAL = 4.184;

function finite(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function kcalFromOffNutriments(
  nutriments: Record<string, unknown> | undefined | null,
): number | null {
  const n = nutriments ?? {};
  const kcal = finite(n["energy-kcal_100g"]);
  // A negative energy is malformed OFF data → treat as absent (parity with the
  // seed mapper's macro guard, so neither path persists a negative-kcal food).
  if (kcal !== null) return kcal < 0 ? null : kcal;
  // kJ fallback: prefer the explicit kJ field, then the generic `energy_100g`
  // (kJ by OFF convention). Round to 1 dp — the conversion is an approximation.
  const kj = finite(n["energy-kj_100g"]) ?? finite(n["energy_100g"]);
  if (kj !== null && kj >= 0) return Math.round((kj / KJ_PER_KCAL) * 10) / 10;
  return null;
}
