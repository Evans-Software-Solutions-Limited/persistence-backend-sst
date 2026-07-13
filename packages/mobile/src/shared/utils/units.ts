/**
 * Weight / volume / height display-unit helpers (device-QA #8b).
 *
 * The backend stores and returns everything in **kilograms** (and height in
 * centimetres); the display unit is the user's `profiles.weightUnit` /
 * `heightUnit` preference. These helpers convert a stored value into the
 * display unit at the render boundary. Kilogram/centimetre output is passed
 * through unchanged so existing kg/cm surfaces never regress visually — only
 * the imperial (`lb` / `ftin`) branch converts + relabels.
 */

export type WeightUnit = "kg" | "lb";
export type HeightUnit = "cm" | "ftin";

/** Exact kilograms per pound (also used by the weigh-in / log-weight inputs). */
export const KG_PER_LB = 0.45359237;
/** Centimetres per inch. */
export const CM_PER_INCH = 2.54;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}
export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/**
 * A stored-kg weight as the display unit's NUMBER. `kg` passes through
 * unchanged (no formatting change for metric users); `lb` is converted and
 * rounded to one decimal (the precision a body/lift weight is shown at).
 */
export function weightInUnit(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? Math.round(kgToLb(kg) * 10) / 10 : kg;
}

/**
 * Format a stored-kg weight as "<value> <unit>", e.g. `formatWeight(72.5,"kg")`
 * → "72.5 kg", `formatWeight(72.5,"lb")` → "159.8 lb". `decimals` controls the
 * fixed precision (default 1, matching the body-weight tile).
 */
export function formatWeight(
  kg: number,
  unit: WeightUnit,
  decimals = 1,
): string {
  // Convert the RAW value then round once to `decimals` — going through
  // `weightInUnit` (which pre-rounds lb to 1dp) would double-round.
  const value = unit === "lb" ? kgToLb(kg) : kg;
  return `${value.toFixed(decimals)} ${unit}`;
}

/**
 * A stored-kg VOLUME total as an integer in the display unit — for surfaces
 * that render the number and its unit label separately (per-muscle rows,
 * weekly-volume Stat tiles). Rounded to a whole number in both units.
 */
export function volumeInUnit(kg: number, unit: WeightUnit): number {
  return Math.round(unit === "lb" ? kgToLb(kg) : kg);
}

/**
 * A stored-kg VOLUME total as `{ value, unit }` for a headline Stat tile.
 * Metric users see tonnes once the total reaches 1 t (matching the existing
 * "t" headline), otherwise kilograms; imperial users see pounds. `value`
 * carries thousands separators for the whole-number branches.
 */
export function formatVolumeParts(
  kg: number,
  unit: WeightUnit,
): { value: string; unit: string } {
  if (unit === "lb") {
    return {
      value: Math.round(kgToLb(kg)).toLocaleString("en-US"),
      unit: "lb",
    };
  }
  return kg >= 1000
    ? { value: (kg / 1000).toFixed(1), unit: "t" }
    : { value: Math.round(kg).toLocaleString("en-US"), unit: "kg" };
}

/** `formatVolumeParts` as a single "<value> <unit>" string. */
export function formatVolume(kg: number, unit: WeightUnit): string {
  const { value, unit: u } = formatVolumeParts(kg, unit);
  return `${value} ${u}`;
}

/** Split a centimetre height into whole feet + inches (inches rounded). */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

/**
 * Format a stored-cm height for display: "178 cm" (metric) or `5'10"`
 * (imperial). Returns an em dash for a null height.
 */
export function formatHeight(
  cm: number | null | undefined,
  unit: HeightUnit,
): string {
  if (cm == null) return "—";
  if (unit === "ftin") {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet}'${inches}"`;
  }
  return `${Math.round(cm)} cm`;
}
