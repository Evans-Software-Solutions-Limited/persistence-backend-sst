/**
 * Water-unit conversion (fix/water-litres-habit-bridge).
 *
 * Water is modelled in TWO units that must stay consistent:
 *  - The water HABIT target (`habit_configs`, category "water") is in LITRES
 *    (unit "l", default 2.0 l/day, completionRule `value_gte`).
 *  - The Fuel water LOG is stored in CUPS (`water_log.cups`, integer) — the
 *    wire/storage unit, unchanged (no migration).
 *
 * Brad's decision (2026-07-06): LITRES EVERYWHERE at the UI + bridge boundary,
 * 1 cup = 250 ml = 0.25 L exactly. Storage stays in cups (0.25 L ↔ 1 cup maps
 * with no rounding), and we convert at the edges so the water tracker shows
 * litres, the habit target compares in litres, and the wire still sends integer
 * cups.
 *
 * `LITRES_PER_CUP` is the single source of truth — never hardcode 0.25.
 */

/** Millilitres in one logged cup (the storage grain). */
export const ML_PER_CUP = 250;

/** Litres in one logged cup — the litres↔cups conversion factor (0.25). */
export const LITRES_PER_CUP = ML_PER_CUP / 1000;

/** Cups → litres (e.g. 8 cups → 2.0 L). */
export function cupsToLitres(cups: number): number {
  return cups * LITRES_PER_CUP;
}

/**
 * Litres → cups (the storage/wire grain). Rounds to the nearest whole cup so a
 * 0.25 L step lands on exactly ±1 cup and any float drift in litres arithmetic
 * (e.g. 0.1 + 0.2) can't leak a fractional cup into the water log.
 */
export function litresToCups(litres: number): number {
  return Math.round(litres / LITRES_PER_CUP);
}
