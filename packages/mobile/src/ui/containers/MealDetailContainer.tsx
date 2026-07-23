import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { useFuelSheets } from "@/state/fuel-sheets";
import { dayLabel, loggedAtNoonUtc, localDayISO } from "@/shared/utils";
import { defaultMealSlot } from "@/domain/services";
import { MealDetailPresenter } from "@/ui/presenters/MealDetailPresenter";

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
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <MealDetailContainer>
 */

export function MealDetailContainer({ id }: { id: string }) {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const meals = useGetMeals();
  const logEntry = useLogEntry();
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  // The day Fuel is viewing (QA-20) — kept in sync by <FuelContainer>, so
  // logging a meal from a past-day view lands on that day, not today.
  const activeDate = useFuelSheets((s) => s.date);
  // Day-context (QA-20) — only surfaced on a past day.
  const dayContext =
    activeDate === localDayISO() ? undefined : dayLabel(activeDate);
  const [isLogging, setIsLogging] = useState(false);

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

  const onLogToToday = useCallback(async () => {
    setIsLogging(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await logEntry.mutate({
        mealId: id,
        mealSlot: defaultMealSlot(new Date()),
        servings: 1,
        loggedAt: loggedAtNoonUtc(activeDate),
      });
      notifyMutated();
      router.back();
    } finally {
      setIsLogging(false);
    }
  }, [id, logEntry, notifyMutated, activeDate]);

  return (
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
      onLogToToday={() => void onLogToToday()}
      isLogging={isLogging}
      dayContext={dayContext}
    />
  );
}
