/**
 * 1.2.0 contract fixtures for nutrition entries (PER-109).
 *
 * Recorded from the app that shipped as 1.2.0 (main at c1bf892, app.json
 * 1.2.0) — the store JavaScript that phones run until they download the next
 * over-the-air update, and so the backend's most important client:
 *
 * - request bodies: `logEntryCommand`'s queued payload
 *   (packages/mobile/src/application/commands/nutrition.command.ts) and the
 *   `EditEntryInput` the edit sheet sends;
 * - request headers: the sync drain (sync.command.ts) sends `Content-Type`,
 *   `Authorization` and, for rows enqueued since the column existed, an
 *   `Idempotency-Key` minted by `newIdempotencyKey` in sqlite.adapter.ts as
 *   `<entityId>-<epochMs>-<random>`, where entityId is the `local-…` id;
 * - response shapes: `NutritionEntry`, `FuelToday` and `Consumed` in
 *   packages/mobile/src/domain/models/nutrition.ts.
 *
 * ⚠ Don't edit these to make a failing test pass. A failure here means a 1.2.0
 * phone would break. Only additive changes are allowed (no `/v2`): new
 * OPTIONAL request fields and new response fields older apps ignore.
 */

export type JsonType = "string" | "number" | "boolean" | "object" | "array";
export type FieldSpec = { type: JsonType; nullable: boolean };

/** `NutritionEntry` as 1.2.0 reads it. Every field must be present. */
export const ENTRY_FIELDS_120: Record<string, FieldSpec> = {
  id: { type: "string", nullable: false },
  userId: { type: "string", nullable: false },
  foodId: { type: "string", nullable: true },
  recipeId: { type: "string", nullable: true },
  mealId: { type: "string", nullable: true },
  mealSlot: { type: "string", nullable: false },
  servings: { type: "number", nullable: false },
  kcal: { type: "number", nullable: false },
  proteinG: { type: "number", nullable: false },
  carbsG: { type: "number", nullable: false },
  fatG: { type: "number", nullable: false },
  loggedAt: { type: "string", nullable: false },
  loggedByUserId: { type: "string", nullable: true },
  aiEstimated: { type: "boolean", nullable: false },
  aiConfidence: { type: "number", nullable: true },
  customName: { type: "string", nullable: true },
};

export const MEAL_SLOTS_120 = ["breakfast", "lunch", "snack", "dinner"];

/** `FuelToday` / `Consumed` as 1.2.0 reads them. */
export const FUEL_TODAY_FIELDS_120: Record<string, FieldSpec> = {
  date: { type: "string", nullable: false },
  targets: { type: "object", nullable: true },
  consumed: { type: "object", nullable: false },
  remainingKcal: { type: "number", nullable: false },
  entriesBySlot: { type: "object", nullable: false },
};
export const CONSUMED_FIELDS_120: Record<string, FieldSpec> = {
  kcal: { type: "number", nullable: false },
  proteinG: { type: "number", nullable: false },
  carbsG: { type: "number", nullable: false },
  fatG: { type: "number", nullable: false },
  waterCups: { type: "number", nullable: false },
};

/** An `Idempotency-Key` exactly as the 1.2.0 queue mints it. */
export function idempotencyKey120(n: number): string {
  return `local-1763640000000-a1b2c3-${1763640000100 + n}-k3j9x2m${n}`;
}

export const LOGGED_AT_120 = "2026-11-20T12:30:00.000Z";
export const DAY_120 = "2026-11-20";

/**
 * The bodies a 1.2.0 phone queues for `POST /nutrition/entries`. References
 * are filled in by the test (`{foodId}` etc. stand for the seeded rows); a
 * referenced log sends no macros because the server derives them. JSON drops
 * the `undefined` fields `logEntryCommand` builds, so they're omitted here.
 */
export const LOG_BODIES_120 = {
  food: (foodId: string) => ({
    foodId,
    mealSlot: "breakfast",
    servings: 2,
    loggedAt: LOGGED_AT_120,
  }),
  recipe: (recipeId: string) => ({
    recipeId,
    mealSlot: "dinner",
    servings: 1,
    loggedAt: LOGGED_AT_120,
  }),
  savedMeal: (mealId: string) => ({
    mealId,
    mealSlot: "lunch",
    servings: 1,
    loggedAt: LOGGED_AT_120,
  }),
  quickLog: () => ({
    mealSlot: "snack",
    servings: 1,
    kcal: 210,
    proteinG: 4,
    carbsG: 30,
    fatG: 9,
    customName: "Flapjack",
    loggedAt: LOGGED_AT_120,
  }),
  aiEstimate: () => ({
    mealSlot: "lunch",
    servings: 1,
    kcal: 640,
    proteinG: 38,
    carbsG: 60,
    fatG: 24,
    customName: "Chicken burrito bowl",
    aiEstimated: true,
    aiConfidence: 0.72,
    loggedAt: LOGGED_AT_120,
  }),
};

/** `EditEntryInput` from the 1.2.0 edit sheet. */
export const EDIT_BODY_120 = { mealSlot: "dinner", servings: 3 };
