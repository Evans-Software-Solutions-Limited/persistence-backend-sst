/**
 * Nutrition (Fuel) mutation commands — M9. Offline-capable: each does an
 * OPTIMISTIC local cache write then enqueues the wire mutation, mirroring
 * `toggleHabitDayCommand`. No direct network call — the sync worker drains the
 * queue; the cache-first read hooks render the optimistic state immediately.
 *
 * The day aggregate (`cached_fuel_today`) is recomputed client-side after each
 * entry/water/target change (via the pure nutrition service) so the Fuel ring
 * updates with no round-trip. On the next refresh the server-truth aggregate
 * wholesale-replaces the optimistic one (server-wins / LWW reconcile).
 *
 * Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Sync queue entity types
 */
import type { StoragePort } from "@/domain/ports/storage.port";
import type {
  CreateMealInput,
  CreateRecipeInput,
  EditEntryInput,
  FuelToday,
  LogEntryInput,
  Meal,
  NutritionEntry,
  NutritionTarget,
  Recipe,
  SetTargetsInput,
} from "@/domain/models/nutrition";
import {
  flattenFuelEntries,
  recomputeFuelToday,
  scaleFoodMacros,
  scaleRecipeMacros,
  setFuelTargets,
  setFuelWater,
} from "@/domain/services/nutrition.service";
import { setHabitCompletion } from "@/application/commands/toggle-habit.command";
import { cupsToLitres } from "@/shared/utils";

export type NutritionCommandDeps = {
  storage: StoragePort;
  userId: string;
  /** Stable id for an optimistic local row. */
  idFactory: () => string;
};

/** YYYY-MM-DD of an ISO timestamp's date part (the cache day key). */
function dayKey(loggedAt: string): string {
  return loggedAt.slice(0, 10);
}

/** An empty day aggregate to seed the cache when nothing's cached yet offline. */
function emptyFuel(date: string, target: NutritionTarget | null): FuelToday {
  return {
    date,
    targets: target,
    consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
    remainingKcal: target ? target.dailyKcal : 0,
    entriesBySlot: { breakfast: [], lunch: [], snack: [], dinner: [] },
  };
}

function readFuel(
  storage: StoragePort,
  userId: string,
  date: string,
): FuelToday {
  return (
    storage.getCachedFuelToday(userId, date) ??
    emptyFuel(date, storage.getCachedNutritionTarget(userId))
  );
}

/**
 * Log an entry. Derives optimistic macros from the referenced cached food /
 * recipe (server re-derives authoritatively on flush); falls back to the
 * client-supplied macros for a one-off.
 */
export function logEntryCommand(
  deps: NutritionCommandDeps,
  input: LogEntryInput,
): NutritionEntry {
  const { storage, userId } = deps;
  const date = dayKey(input.loggedAt);

  let macro = {
    kcal: input.kcal ?? 0,
    proteinG: input.proteinG ?? 0,
    carbsG: input.carbsG ?? 0,
    fatG: input.fatG ?? 0,
  };
  if (input.foodId) {
    const food = storage.getCachedFoodById(input.foodId);
    if (food) macro = scaleFoodMacros(food, input.servings);
  } else if (input.recipeId) {
    const recipe = storage.getCachedRecipe(userId, input.recipeId);
    if (recipe) macro = scaleRecipeMacros(recipe, input.servings);
  }

  const entry: NutritionEntry = {
    id: `local-${deps.idFactory()}`,
    userId,
    foodId: input.foodId ?? null,
    recipeId: input.recipeId ?? null,
    mealId: input.mealId ?? null,
    mealSlot: input.mealSlot,
    servings: input.servings,
    ...macro,
    loggedAt: input.loggedAt,
    loggedByUserId: null,
    aiEstimated: false,
    aiConfidence: null,
  };

  const fuel = readFuel(storage, userId, date);
  const next = recomputeFuelToday(fuel, [...flattenFuelEntries(fuel), entry]);
  storage.cacheFuelToday(userId, date, next);

  storage.enqueueMutation({
    entityType: "nutrition_entry",
    entityId: entry.id,
    operation: "create",
    payload: {
      foodId: input.foodId,
      recipeId: input.recipeId,
      mealId: input.mealId,
      mealSlot: input.mealSlot,
      servings: input.servings,
      kcal: input.kcal,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      loggedAt: input.loggedAt,
    },
    endpoint: "/nutrition/entries",
    method: "POST",
  });

  return entry;
}

/** Edit an entry's servings/slot/macros within a cached day. */
export function editEntryCommand(
  deps: NutritionCommandDeps,
  id: string,
  date: string,
  input: EditEntryInput,
): void {
  const { storage, userId } = deps;
  const fuel = readFuel(storage, userId, date);
  const entries = flattenFuelEntries(fuel).map((e) =>
    e.id === id ? { ...e, ...input } : e,
  );
  storage.cacheFuelToday(userId, date, recomputeFuelToday(fuel, entries));

  storage.enqueueMutation({
    entityType: "nutrition_entry",
    entityId: id,
    operation: "update",
    payload: input,
    endpoint: `/nutrition/entries/${id}`,
    method: "PUT",
  });
}

/** Delete an entry from a cached day. */
export function deleteEntryCommand(
  deps: NutritionCommandDeps,
  id: string,
  date: string,
): void {
  const { storage, userId } = deps;
  const fuel = readFuel(storage, userId, date);
  const entries = flattenFuelEntries(fuel).filter((e) => e.id !== id);
  storage.cacheFuelToday(userId, date, recomputeFuelToday(fuel, entries));

  storage.enqueueMutation({
    entityType: "nutrition_entry",
    entityId: id,
    operation: "delete",
    payload: {},
    endpoint: `/nutrition/entries/${id}`,
    method: "DELETE",
  });
}

/** Upsert the daily target (optimistic) + refresh the cached day's remaining. */
export function setTargetCommand(
  deps: NutritionCommandDeps,
  input: SetTargetsInput,
  date: string,
): NutritionTarget {
  const { storage, userId } = deps;
  const prev = storage.getCachedNutritionTarget(userId);
  const target: NutritionTarget = {
    userId,
    dailyKcal: input.dailyKcal,
    proteinG: input.proteinG,
    carbsG: input.carbsG,
    fatG: input.fatG,
    waterCups: input.waterCups,
    preset: input.preset ?? "custom",
    // Self-write never touches trainer attribution.
    setByUserId: prev?.setByUserId ?? null,
    setByName: prev?.setByName ?? null,
    updatedAt: new Date().toISOString(),
  };
  storage.cacheNutritionTarget(userId, target);

  const fuel = storage.getCachedFuelToday(userId, date);
  if (fuel) storage.cacheFuelToday(userId, date, setFuelTargets(fuel, target));

  storage.enqueueMutation({
    entityType: "nutrition_target",
    entityId: userId,
    operation: "update",
    payload: input,
    endpoint: "/nutrition/targets",
    method: "PUT",
  });

  return target;
}

/**
 * Set the day's water cups (ABSOLUTE, last-write-wins). Coalesces onto any
 * still-pending water mutation for the same day so rapid +/- taps don't bloat
 * the queue and replay stays idempotent (BACKEND_BRIEF § 4).
 *
 * Also BRIDGES the log to the water HABIT (fix/water-litres-habit-bridge):
 * water is logged in cups but the water habit target is in LITRES, and logging
 * used to never tick the habit. After writing the log we reflect the habit's
 * binary daily threshold — a completion exists for today iff the logged litres
 * (`cups × 0.25`) meet the habit's `targetValue` (litres). See
 * `reflectWaterHabit`.
 */
export function setWaterCommand(
  deps: NutritionCommandDeps,
  date: string,
  cups: number,
): void {
  const { storage, userId } = deps;
  const next = Math.max(0, Math.trunc(cups));

  // Seed an empty day if nothing's cached yet so the optimistic water still
  // shows on a cold cache (offline first-set).
  const fuel = readFuel(storage, userId, date);
  storage.cacheFuelToday(userId, date, setFuelWater(fuel, next));

  const payload = { date, cups: next };
  const pending = storage
    .getPendingMutations()
    .find((e) => e.entityType === "water_log" && e.entityId === date);
  if (pending) {
    storage.updateMutationPayload(pending.id, payload);
  } else {
    storage.enqueueMutation({
      entityType: "water_log",
      entityId: date,
      operation: "update",
      payload,
      endpoint: "/nutrition/water/today",
      method: "PATCH",
    });
  }

  reflectWaterHabit(deps, date, next);
}

/**
 * Reflect the day's water log into the water HABIT completion (binary daily
 * threshold). No-op unless the user has an ACTIVE, enabled water habit with a
 * real `goalId` and a litres `targetValue`.
 *
 * - logged litres (`cups × 0.25`) ≥ target → ensure TODAY is ticked with
 *   `value = targetValue` (litres) — identical to the Home grid tile's write,
 *   so tile + log stay consistent.
 * - below target → ensure TODAY is un-ticked.
 *
 * Idempotent: only enqueues a POST when not already ticked, only a DELETE when
 * currently ticked — checked against the cached completions for today — so
 * repeated +/- taps at a steady state don't spam the queue. Invalidates Home
 * once when the tick state actually changed so the grid re-reads the new state.
 */
function reflectWaterHabit(
  deps: NutritionCommandDeps,
  date: string,
  cups: number,
): void {
  const { storage, userId } = deps;

  const water = storage
    .getHabitConfigs(userId)
    .find((c) => c.category === "water");
  if (!water || !water.enabled || !water.goalId) return;

  const goalId = water.goalId;
  const target = water.targetValue;
  const totalLitres = cupsToLitres(cups);
  const shouldTick = totalLitres >= target;

  const alreadyTicked = storage
    .getCachedHabitCompletions(userId, { goalId })
    .some((r) => (r.localCompletedDate ?? r.completedAt.slice(0, 10)) === date);

  // No state change → don't touch the cache or queue (idempotent).
  if (shouldTick === alreadyTicked) return;

  setHabitCompletion(storage, {
    userId,
    goalId,
    day: date,
    done: shouldTick,
    // value_gte habit — the completion carries the litres target, matching the
    // grid tile so the backend's onConflictDoNothing sees a constant value.
    value: shouldTick ? target : undefined,
    idFactory: deps.idFactory,
  });

  storage.invalidateHome(userId);
}

/** Optimistically insert a recipe + enqueue its create (server materialises totals). */
export function createRecipeCommand(
  deps: NutritionCommandDeps,
  input: CreateRecipeInput,
  optimisticTotals: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  },
): Recipe {
  const { storage, userId } = deps;
  const recipe: Recipe = {
    id: `local-${deps.idFactory()}`,
    userId,
    name: input.name,
    photoUrl: input.photoUrl ?? null,
    servings: input.servings,
    instructions: input.instructions ?? null,
    source: "manual",
    sourceUrl: null,
    totalKcal: optimisticTotals.kcal,
    totalProteinG: optimisticTotals.proteinG,
    totalCarbsG: optimisticTotals.carbsG,
    totalFatG: optimisticTotals.fatG,
    ingredients: input.ingredients.map((ing, i) => ({
      id: `local-ing-${i}`,
      foodId: ing.foodId ?? null,
      customName: ing.customName ?? null,
      quantity: ing.quantity,
      unit: ing.unit,
      sortOrder: ing.sortOrder,
    })),
  };
  storage.cacheRecipe(userId, recipe);

  storage.enqueueMutation({
    entityType: "recipe",
    entityId: recipe.id,
    operation: "create",
    payload: input,
    endpoint: "/recipes",
    method: "POST",
  });

  return recipe;
}

/** Optimistically insert a meal + enqueue its create (server materialises totals). */
export function createMealCommand(
  deps: NutritionCommandDeps,
  input: CreateMealInput,
  optimisticTotals: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  },
): Meal {
  const { storage, userId } = deps;
  const meal: Meal = {
    id: `local-${deps.idFactory()}`,
    userId,
    name: input.name,
    photoUrl: input.photoUrl ?? null,
    totalKcal: optimisticTotals.kcal,
    totalProteinG: optimisticTotals.proteinG,
    totalCarbsG: optimisticTotals.carbsG,
    totalFatG: optimisticTotals.fatG,
    items: input.items.map((it, i) => ({
      id: `local-item-${i}`,
      foodId: it.foodId ?? null,
      recipeId: it.recipeId ?? null,
      servings: it.servings,
      sortOrder: it.sortOrder,
    })),
  };
  storage.cacheMeal(userId, meal);

  storage.enqueueMutation({
    entityType: "meal",
    entityId: meal.id,
    operation: "create",
    payload: input,
    endpoint: "/meals",
    method: "POST",
  });

  return meal;
}
