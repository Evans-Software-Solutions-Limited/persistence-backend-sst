import type {
  MealSlot,
  NutritionEntryDTO,
} from "../../repositories/nutritionEntryRepository";
import type { UserMealDTO } from "../../repositories/userMealRepository";

/**
 * The meal an entry without a `userMealId` (logged by an older bundle, or
 * before Your meals existed) is shown under: the default meal for its slot.
 *
 * - the seeded default whose key is the slot, if it is still active and still
 *   maps to that slot;
 * - otherwise the first active meal (display order) that maps to the slot;
 * - otherwise null — the phone falls back to `mealSlot`, as today.
 *
 * `meals` must be the user's ACTIVE meals in display order.
 */
export function defaultUserMealIdForSlot(
  meals: readonly UserMealDTO[],
  slot: MealSlot,
): string | null {
  const inSlot = meals.filter((m) => m.logSlot === slot);
  return (inSlot.find((m) => m.defaultKey === slot) ?? inSlot[0])?.id ?? null;
}

/**
 * Entry reads return `userMealId` for every entry: the stored one, or the
 * default meal for its slot. Stored ids are never rewritten, even when that
 * meal has since been archived (its entries keep `user_meal_id`).
 */
export function withEffectiveUserMealIds(
  entries: readonly NutritionEntryDTO[],
  meals: readonly UserMealDTO[],
): NutritionEntryDTO[] {
  return entries.map((e) =>
    e.userMealId !== null
      ? e
      : { ...e, userMealId: defaultUserMealIdForSlot(meals, e.mealSlot) },
  );
}

/** Only entries missing a `userMealId` need the meals list at all. */
export function needsUserMeals(entries: readonly NutritionEntryDTO[]): boolean {
  return entries.some((e) => e.userMealId === null);
}
