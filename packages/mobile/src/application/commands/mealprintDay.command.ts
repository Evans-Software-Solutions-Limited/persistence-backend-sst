import type { LogEntryInput, NutritionEntry } from "@/domain/models/nutrition";
import type { NutritionPlan } from "@/domain/models/nutritionPlans";
import type { StoragePort } from "@/domain/ports/storage.port";
import { flattenFuelEntries } from "@/domain/services/nutrition.service";
import { resolveLoggedEntryIds } from "@/domain/services/mealprintDay.service";
import {
  deleteEntryCommand,
  logEntryCommand,
  type NutritionCommandDeps,
} from "./nutrition.command";
import { readPlansCache } from "./nutritionPlans.command";

/**
 * Mealprint whole day (PER-134, canvas N21/N22): put a saved plan under Mine,
 * log the day into today, and undo that log. Offline-first like every other
 * food log: each entry is cached and queued with its own key, so one drain
 * sends them all in a single `POST /nutrition/entries/batch` (PER-132).
 */

/** The plan "Save as a plan" created shows under Mine straight away. */
export function adoptSavedMealprintPlanCommand(
  storage: StoragePort,
  userId: string,
  plan: NutritionPlan,
): void {
  const cache = readPlansCache(storage, userId);
  storage.cacheNutritionPlans(userId, {
    ...cache,
    mine: [...cache.mine.filter((p) => p.id !== plan.id), plan],
  });
}

/** The ids already in a cached day, so Undo can tell new entries apart. */
export function dayEntryIds(
  storage: StoragePort,
  userId: string,
  date: string,
): Set<string> {
  const fuel = storage.getCachedFuelToday(userId, date);
  return new Set(fuel ? flattenFuelEntries(fuel).map((e) => e.id) : []);
}

/** Log every entry of "Log all today". Returns the optimistic entries. */
export function logAllTodayCommand(
  deps: NutritionCommandDeps,
  inputs: readonly LogEntryInput[],
): NutritionEntry[] {
  return inputs.map((input) => logEntryCommand(deps, input));
}

/**
 * Undo "Log all today": delete what it logged, whether or not it has synced
 * yet (an unsent entry is simply dropped from the queue). Returns how many
 * entries were removed.
 */
export function undoLogAllCommand(
  deps: NutritionCommandDeps,
  date: string,
  before: ReadonlySet<string>,
  logged: readonly NutritionEntry[],
): number {
  const fuel = deps.storage.getCachedFuelToday(deps.userId, date);
  const current = fuel ? flattenFuelEntries(fuel) : [];
  const ids = resolveLoggedEntryIds(before, logged, current);
  for (const id of ids) deleteEntryCommand(deps, id, date);
  return ids.length;
}
