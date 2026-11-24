import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { MealDetailPresenter } from "@/ui/presenters/MealDetailPresenter";
import { LogMealSheetContainer } from "./LogMealSheetContainer";
import { AddToPlanSheetContainer } from "./AddToPlanSheetContainer";

/**
 * <MealDetailContainer> — `/(app)/fuel/meal/[id]` (recipes.jsx
 * `RecipeDetail`, `kind: 'meal'` branch). Read-only in PR1.
 *
 * There is no singular `GET /meals/:id` hook on the mobile side yet (the
 * ApiPort only exposes the list read — `useGetMeals()`), so the meal is
 * looked up in the already-cached list by id, same as
 * `QuickAddSheetContainer`'s `lookups.meal`. `GET /meals` (list) omits item
 * detail ("cards; items omitted" — mealsListHandler.ts), so a meal synced
 * down from the server shows no item summary here; a meal created via THIS
 * PR's Save-a-meal flow has its items immediately (optimistic local cache).
 *
 * PER-133 (N13/N14): "Log meal" opens the Log sheet (day, meal, portion) and
 * "Add to plan" adds the meal to one of the person's own plans.
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <MealDetailContainer>
 */

export function MealDetailContainer({ id }: { id: string }) {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const meals = useGetMeals();
  const [sheet, setSheet] = useState<"log" | "plan" | null>(null);

  const meal = useMemo(
    () => (meals.data ?? []).find((m) => m.id === id) ?? null,
    [meals.data, id],
  );
  const found = meal !== null;
  // `useGetMeals` reads `storage.getCachedMeals(userId)`, which returns `Meal[]`
  // ([] when empty, never null for a signed-in user), so gating on
  // `meals.data === null` would make this permanently false and flash
  // "not found" during a cold-cache fetch. Mirror RecipeDetailContainer:
  // gate the presenter's loader on `isLoading && !found`, so a warm-cache hit
  // shows the meal immediately and only a genuinely-missing id (after the
  // refresh resolves isStale→false) falls through to not-found.
  const isLoading =
    meals.isRefreshing || (meals.isStale && meals.error === null);

  const itemsSummary = useMemo(() => {
    if (!meal || meal.items.length === 0) return null;
    const names = meal.items
      .map((item) => {
        if (item.foodId)
          return storage.getCachedFoodById(item.foodId)?.name ?? null;
        if (item.recipeId && userId) {
          return storage.getCachedRecipe(userId, item.recipeId)?.name ?? null;
        }
        return null;
      })
      .filter((n): n is string => n !== null);
    return names.length > 0 ? names.join(" + ") : null;
  }, [meal, storage, userId]);

  const onBack = useCallback(() => router.back(), []);
  const onRetry = useCallback(() => {
    void meals.refresh();
  }, [meals]);

  const onCloseSheet = useCallback(() => setSheet(null), []);
  const onLogged = useCallback(() => {
    setSheet(null);
    router.back();
  }, []);

  return (
    <>
      <MealDetailPresenter
        found={found}
        isLoading={isLoading}
        error={meals.error}
        onRetry={onRetry}
        onBack={onBack}
        name={meal?.name ?? ""}
        itemsSummary={itemsSummary}
        kcal={meal?.totalKcal ?? 0}
        proteinG={meal?.totalProteinG ?? 0}
        carbsG={meal?.totalCarbsG ?? 0}
        fatG={meal?.totalFatG ?? 0}
        onLog={() => setSheet("log")}
        onAddToPlan={() => setSheet("plan")}
      />
      <LogMealSheetContainer
        visible={sheet === "log" && meal !== null}
        item={
          meal
            ? {
                kind: "meal",
                id: meal.id,
                name: meal.name,
                kcal: meal.totalKcal,
              }
            : null
        }
        onClose={onCloseSheet}
        onLogged={onLogged}
      />
      <AddToPlanSheetContainer
        visible={sheet === "plan" && meal !== null}
        source={meal ? { kind: "meal", meal } : null}
        onClose={onCloseSheet}
      />
    </>
  );
}
