import { useCallback, useMemo, useState } from "react";
import { router, type Href } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useLogEntries } from "@/ui/hooks/useLogEntries";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useAddRecipeMenu } from "@/state/add-recipe-menu";
import { addDaysISO, localDayISO, loggedAtNoonUtc } from "@/shared/utils";
import {
  defaultMealSlot,
  entryDisplayLabel,
  flattenFuelEntries,
  perServingDivisor,
} from "@/domain/services";
import {
  defaultUserMealIdForSlot,
  logTargetForUserMeal,
  recentEntries,
  relogInput,
} from "@/domain/services/userMeals.service";
import type {
  Food,
  LogEntryInput,
  Meal,
  NutritionEntry,
  Recipe,
} from "@/domain/models/nutrition";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  MealsTabPresenter,
  type MealsLibrary,
  type MealsTabRowVM,
} from "@/ui/presenters/fuel/MealsTabPresenter";

/**
 * <MealsTabContainer> — the Meals section of the Fuel screen (PER-133, canvas
 * N11 / N12). Saved meals (most used first), recipes (one portion) and foods
 * logged recently, all from the phone's caches. A row opens its detail page;
 * "+" logs one serving into the meal for the time of day, today.
 *
 * Mount it inside the Fuel ScrollView, under the header and the switch. The
 * header's "New meal or recipe" button calls `useMealsTabNew()`.
 */

/** How many days back (today included) "used most" and "Foods · recent" read. */
export const MEALS_RECENT_DAYS = 14;

const fmtNum = (n: number) =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "4 foods", or "" when the cached list has no item detail. */
export function savedMealSub(meal: Meal): string {
  return meal.items.length > 0
    ? plural(meal.items.length, "food", "foods")
    : "";
}

/** "Imported · bbcgoodfood.com · 6 portions" / "My recipe · 2 portions". */
export function recipeSub(recipe: Recipe): string {
  const portions = plural(
    perServingDivisor(recipe.servings),
    "portion",
    "portions",
  );
  if (recipe.sourceUrl) {
    const host = recipe.sourceUrl
      .replace(/^https?:\/\/(www\.)?/, "")
      .split("/")[0];
    return host ? `Imported · ${host} · ${portions}` : `Imported · ${portions}`;
  }
  return `My recipe · ${portions}`;
}

/** "85 g", "2 × 85 g", or "2 servings" when the food isn't cached. */
export function foodSub(entry: NutritionEntry, food: Food | null): string {
  if (!food) return plural(entry.servings, "serving", "servings");
  const amount = `${fmtNum(food.servingSize)} ${food.servingUnit}`;
  return entry.servings === 1
    ? amount
    : `${fmtNum(entry.servings)} × ${amount}`;
}

/** Saved meals ordered by how often they were logged on the cached days. */
export function savedMealsByUse(
  meals: readonly Meal[],
  entries: readonly NutritionEntry[],
): Meal[] {
  const uses = new Map<string, number>();
  for (const e of entries) {
    if (e.mealId) uses.set(e.mealId, (uses.get(e.mealId) ?? 0) + 1);
  }
  return meals
    .map((m, i) => ({ m, i, n: uses.get(m.id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.m);
}

function matches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q);
}

/** The meal "+" logs into: the one for the time of day (Log's quick buttons). */
export function mealForNow(
  meals: readonly UserMeal[],
  now: Date,
): UserMeal | null {
  const id = defaultUserMealIdForSlot(meals, defaultMealSlot(now));
  return meals.find((m) => m.id === id) ?? meals[0] ?? null;
}

/** The header's "New meal or recipe" button: opens the add-recipe menu. */
export function useMealsTabNew(): () => void {
  return useAddRecipeMenu((s) => s.openMenu);
}

export type MealsTabContainerProps = {
  testID?: string;
};

type LogTarget =
  | { kind: "meal"; meal: Meal }
  | { kind: "recipe"; recipe: Recipe }
  | { kind: "food"; entry: NutritionEntry };

export function MealsTabContainer({ testID }: MealsTabContainerProps = {}) {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const rev = useFuelSheets((s) => s.rev);
  const savedMeals = useGetMeals();
  const recipes = useGetRecipes();
  const userMeals = useUserMeals();
  const logEntries = useLogEntries();

  const [library, setLibrary] = useState<MealsLibrary>("saved");
  const [query, setQuery] = useState("");
  const [loggingKey, setLoggingKey] = useState<string | null>(null);

  // Entries of the last two weeks from the offline day cache (no network).
  const cachedEntries = useMemo(() => {
    if (!userId) return [];
    const today = localDayISO();
    const out: NutritionEntry[] = [];
    for (let i = 0; i < MEALS_RECENT_DAYS; i++) {
      const day = storage.getCachedFuelToday(userId, addDaysISO(today, -i));
      if (day) out.push(...flattenFuelEntries(day));
    }
    return out;
    // `rev` re-reads the cache after something was logged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, storage, rev]);

  const { rows, targets } = useMemo(() => {
    const targets = new Map<string, LogTarget>();
    const rows: MealsTabRowVM[] = [];
    if (library === "saved") {
      for (const m of savedMealsByUse(savedMeals.data ?? [], cachedEntries)) {
        if (!matches(m.name, query)) continue;
        const key = `m:${m.id}`;
        targets.set(key, { kind: "meal", meal: m });
        rows.push({
          key,
          name: m.name,
          sub: savedMealSub(m),
          photoUrl: m.photoUrl,
          kcal: m.totalKcal,
          carbsG: m.totalCarbsG,
          fatG: m.totalFatG,
          proteinG: m.totalProteinG,
          canOpen: true,
        });
      }
    } else if (library === "recipes") {
      for (const r of recipes.data ?? []) {
        if (!matches(r.name, query)) continue;
        const key = `r:${r.id}`;
        const div = perServingDivisor(r.servings);
        const per = (v: number | null) => (v === null ? null : v / div);
        targets.set(key, { kind: "recipe", recipe: r });
        rows.push({
          key,
          name: r.name,
          sub: recipeSub(r),
          photoUrl: r.photoUrl,
          kcal: per(r.totalKcal),
          carbsG: per(r.totalCarbsG),
          fatG: per(r.totalFatG),
          proteinG: per(r.totalProteinG),
          canOpen: true,
        });
      }
    } else {
      const foods = cachedEntries.filter((e) => !e.recipeId && !e.mealId);
      for (const { key: rk, entry } of recentEntries(foods)) {
        const food = entry.foodId
          ? (storage.getCachedFoodById(entry.foodId) ?? null)
          : null;
        const name =
          food?.name ??
          entryDisplayLabel(entry, {
            food: () => undefined,
            recipe: () => undefined,
            meal: () => undefined,
          });
        if (!matches(name, query)) continue;
        const key = `f:${rk}`;
        targets.set(key, { kind: "food", entry });
        rows.push({
          key,
          name,
          sub: foodSub(entry, food),
          photoUrl: null,
          kcal: entry.kcal,
          carbsG: entry.carbsG,
          fatG: entry.fatG,
          proteinG: entry.proteinG,
          canOpen: false,
        });
      }
    }
    return { rows, targets };
  }, [library, query, savedMeals.data, recipes.data, cachedEntries, storage]);

  const onOpen = useCallback((key: string) => {
    if (key.startsWith("m:")) {
      router.push(
        `/(app)/fuel/meal/${encodeURIComponent(key.slice(2))}` as Href,
      );
    } else if (key.startsWith("r:")) {
      router.push(
        `/(app)/fuel/recipe/${encodeURIComponent(key.slice(2))}` as Href,
      );
    }
  }, []);

  const onLog = useCallback(
    async (key: string) => {
      const target = targets.get(key);
      const meal = mealForNow(userMeals.meals, new Date());
      if (!target || !meal || loggingKey) return;
      setLoggingKey(key);
      const into = logTargetForUserMeal(meal);
      const loggedAt = loggedAtNoonUtc(localDayISO());
      const input: LogEntryInput =
        target.kind === "meal"
          ? { ...into, mealId: target.meal.id, servings: 1, loggedAt }
          : target.kind === "recipe"
            ? { ...into, recipeId: target.recipe.id, servings: 1, loggedAt }
            : relogInput(target.entry, into, loggedAt);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      try {
        await logEntries.mutate([input]);
        notifyMutated();
      } finally {
        setLoggingKey(null);
      }
    },
    [targets, userMeals.meals, loggingKey, logEntries, notifyMutated],
  );

  return (
    <MealsTabPresenter
      query={query}
      onQuery={setQuery}
      library={library}
      onLibrary={setLibrary}
      rows={rows}
      onOpen={onOpen}
      onLog={(key) => void onLog(key)}
      loggingKey={loggingKey}
      testID={testID}
    />
  );
}
