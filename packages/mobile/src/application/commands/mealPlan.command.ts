/**
 * Mealprint plan mutation commands — spec-26 Phase 2 T-2.6/2.7.
 *
 * Only ONE mutation lives here: logging a planned meal (AC 5.2). Everything
 * else in the plan lifecycle (generate, swap, accept, replace, archive/
 * re-date, delete) is a DIRECT online call — see `api.port.ts`'s "Mealprint
 * day plans" section docstring for why accept/swap/replace stay off the sync
 * queue even though `logPlanMeal` doesn't: a plan accept needs its
 * server-assigned id back before anything downstream (this command included)
 * can address it, so the whole generate→accept run is kept online, the same
 * posture that already makes generation itself online-only (locked decision
 * 9). Logging an ALREADY-accepted meal has no such dependency — the plan and
 * meal ids are already real — so it can queue exactly like a manual
 * `POST /nutrition/entries` (`logEntryCommand`, which this mirrors).
 */
import type { StoragePort } from "@/domain/ports/storage.port";
import type { MealPlan, PlanMeal } from "@/domain/models/mealprint";
import {
  flattenFuelEntries,
  recomputeFuelToday,
} from "@/domain/services/nutrition.service";
import type {
  FuelToday,
  NutritionEntry,
  NutritionTarget,
} from "@/domain/models/nutrition";
import { loggedAtNoonUtc } from "@/shared/utils";

export type MealPlanCommandDeps = {
  storage: StoragePort;
  userId: string;
  /** Stable id for the optimistic local diary row. */
  idFactory: () => string;
};

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

/** Mirrors `nutrition.command.ts`'s private `readFuel` exactly. */
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
 * Log a plan meal (AC 5.2). Optimistic on THREE cache rows, all local:
 *
 *  1. `cached_meal_plans` — flips the meal `planned` → `logged` so the Fuel
 *     ghost row disappears and the Today view's adherence count moves.
 *  2. `cached_fuel_today` — adds the diary row so the ring/meal-log slot total
 *     update with no round trip (mirrors `logEntryCommand`).
 *  3. The sync queue — `POST /nutrition/plans/:id/meals/:mealId/log`, which is
 *     idempotent server-side (a repeat delivery answers `alreadyLogged: true`
 *     rather than double-logging), so a queue replay after a reconnect is
 *     safe.
 *
 * ⚠ **Destructive-default discipline**: this reads the CACHED plan and bails
 * (returns `null`, mutates nothing) if it's missing or the meal isn't found or
 * is already logged — it never fabricates a plan row to flip a meal inside,
 * and it never enqueues a request for a meal this device doesn't believe
 * exists. "Is there saved content worth keeping" is the plan cache itself:
 * absent it, there is nothing safe to optimistically update.
 */
export function logPlanMealCommand(
  deps: MealPlanCommandDeps,
  args: { plan: MealPlan; meal: PlanMeal },
): NutritionEntry | null {
  const { storage, userId, idFactory } = deps;
  const { plan, meal } = args;

  if (meal.state === "logged") return null;

  const entry: NutritionEntry = {
    id: `local-${idFactory()}`,
    userId,
    foodId: null,
    recipeId: meal.recipeId,
    mealId: meal.mealId,
    mealSlot: meal.logSlot,
    servings: 1,
    kcal: meal.kcal,
    proteinG: meal.proteinG,
    carbsG: meal.carbsG,
    fatG: meal.fatG,
    loggedAt: loggedAtNoonUtc(plan.planDate),
    loggedByUserId: null,
    aiEstimated: false,
    aiConfidence: null,
    // Mirrors the backend log handler exactly: a recipe/meal-backed meal
    // carries its id and needs no custom name; an item-list meal is a
    // composed row identified by its plan label.
    customName: meal.recipeId || meal.mealId ? null : meal.label.slice(0, 200),
  };

  // 1. Flip the plan meal locally. `loggedEntryId` carries the OPTIMISTIC
  // local id — good enough for "is this ghost row gone yet" (the only thing
  // any reader checks it for); the next `getActivePlan` refresh replaces the
  // whole row with the server's, real id included.
  const updatedPlan: MealPlan = {
    ...plan,
    meals: plan.meals.map((m) =>
      m.id === meal.id ? { ...m, state: "logged", loggedEntryId: entry.id } : m,
    ),
  };
  storage.cacheMealPlan(userId, updatedPlan);

  // 2. Add the diary row to the day aggregate the same way a manual log does.
  const fuel = readFuel(storage, userId, plan.planDate);
  const next = recomputeFuelToday(fuel, [...flattenFuelEntries(fuel), entry]);
  storage.cacheFuelToday(userId, plan.planDate, next);

  // 3. Queue the write. Empty payload — the endpoint takes none.
  storage.enqueueMutation({
    entityType: "meal_plan_log",
    entityId: meal.id,
    operation: "update",
    payload: {},
    endpoint: `/nutrition/plans/${plan.id}/meals/${meal.id}/log`,
    method: "POST",
  });

  return entry;
}
