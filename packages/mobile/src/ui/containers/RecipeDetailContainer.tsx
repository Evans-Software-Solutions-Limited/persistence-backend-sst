import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useGetRecipe } from "@/ui/hooks/useGetRecipe";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { useFuelSheets } from "@/state/fuel-sheets";
import { localDayISO } from "@/shared/utils";
import { defaultMealSlot } from "@/domain/services";
import {
  RecipeDetailPresenter,
  type RecipeIngredientVM,
} from "@/ui/presenters/RecipeDetailPresenter";

/**
 * <RecipeDetailContainer> — `/(app)/fuel/recipe/[id]` (recipes.jsx
 * `RecipeDetail`, `kind: 'recipe'` branch). Read-only in PR1 — no edit/
 * delete affordance yet.
 *
 * "Log to today" mirrors <QuickAddSheetContainer>'s log flow: noon-UTC
 * `loggedAt` anchor, optimistic macros re-derived server-side (so the client
 * only sends the ref + servings), haptic feedback, `notifyMutated()` so the
 * Fuel screen's day aggregate refreshes on return, then `router.back()`.
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <RecipeDetailContainer>
 */

export function RecipeDetailContainer({ id }: { id: string }) {
  const { storage } = useAdapters();
  const recipe = useGetRecipe(id);
  const logEntry = useLogEntry();
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const [isLogging, setIsLogging] = useState(false);

  const found = recipe.data !== null;
  const isLoading =
    recipe.isRefreshing || (recipe.isStale && recipe.error === null);

  const secondaryLine = useMemo(() => {
    const r = recipe.data;
    if (!r) return "";
    const servingsLabel = `${r.servings} serving${r.servings === 1 ? "" : "s"}`;
    const sourceLabel =
      r.sourceUrl !== null
        ? r.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]
        : r.source === "manual"
          ? "My recipe"
          : r.source;
    return `${servingsLabel} · ${sourceLabel}`;
  }, [recipe.data]);

  const ingredients: RecipeIngredientVM[] = useMemo(() => {
    const r = recipe.data;
    if (!r) return [];
    return r.ingredients.map((ing) => {
      const foodName = ing.foodId
        ? (storage.getCachedFoodById(ing.foodId)?.name ?? null)
        : null;
      const name = foodName ?? ing.customName ?? "Ingredient";
      const label = `${name} · ${ing.quantity} ${ing.unit}`;
      return { id: ing.id, label };
    });
  }, [recipe.data, storage]);

  const onBack = useCallback(() => router.back(), []);
  const onRetry = useCallback(() => {
    void recipe.refresh();
  }, [recipe]);

  const onLogToToday = useCallback(async () => {
    setIsLogging(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await logEntry.mutate({
        recipeId: id,
        mealSlot: defaultMealSlot(new Date()),
        servings: 1,
        loggedAt: `${localDayISO()}T12:00:00.000Z`,
      });
      notifyMutated();
      router.back();
    } finally {
      setIsLogging(false);
    }
  }, [id, logEntry, notifyMutated]);

  return (
    <RecipeDetailPresenter
      found={found}
      isLoading={isLoading}
      error={recipe.error}
      onRetry={onRetry}
      onBack={onBack}
      name={recipe.data?.name ?? ""}
      emoji="🥘"
      secondaryLine={secondaryLine}
      kcal={recipe.data?.totalKcal ?? null}
      proteinG={recipe.data?.totalProteinG ?? null}
      carbsG={recipe.data?.totalCarbsG ?? null}
      fatG={recipe.data?.totalFatG ?? null}
      ingredients={ingredients}
      instructions={recipe.data?.instructions ?? null}
      onLogToToday={() => void onLogToToday()}
      isLogging={isLogging}
    />
  );
}
