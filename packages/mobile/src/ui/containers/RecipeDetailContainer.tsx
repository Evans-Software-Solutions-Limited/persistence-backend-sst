import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useGetRecipe } from "@/ui/hooks/useGetRecipe";
import { perServingDivisor } from "@/domain/services";
import {
  RecipeDetailPresenter,
  type RecipeIngredientVM,
} from "@/ui/presenters/RecipeDetailPresenter";
import { LogMealSheetContainer } from "./LogMealSheetContainer";
import { AddToPlanSheetContainer } from "./AddToPlanSheetContainer";

/**
 * <RecipeDetailContainer> — `/(app)/fuel/recipe/[id]` (recipes.jsx
 * `RecipeDetail`, `kind: 'recipe'` branch). Read-only in PR1 — no edit/
 * delete affordance yet.
 *
 * PER-133 (N13/N14): "Log meal" opens the Log sheet (day, meal, portion;
 * noon-UTC `loggedAt`, ref + servings only, `notifyMutated()`, then
 * `router.back()`) and "Add to plan" adds one portion to one of the
 * person's own plans.
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <RecipeDetailContainer>
 */

export function RecipeDetailContainer({ id }: { id: string }) {
  const { storage } = useAdapters();
  const recipe = useGetRecipe(id);
  const [sheet, setSheet] = useState<"log" | "plan" | null>(null);

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

  // Recipe `total_*` are WHOLE-recipe totals (one serving = total /
  // servings) — the pills display per-serving so "N servings" doesn't read
  // as a contradiction next to a whole-recipe kcal figure. Guards a
  // zero/absent servings count by treating the recipe as a single serving.
  const perServingDiv = perServingDivisor(recipe.data?.servings ?? null);
  const perServingMacro = (total: number | null): number | null =>
    total === null ? null : Math.round(total / perServingDiv);

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

  const onCloseSheet = useCallback(() => setSheet(null), []);
  const onLogged = useCallback(() => {
    setSheet(null);
    router.back();
  }, []);

  const r = recipe.data;
  return (
    <>
      <RecipeDetailPresenter
        found={found}
        isLoading={isLoading}
        error={recipe.error}
        onRetry={onRetry}
        onBack={onBack}
        name={recipe.data?.name ?? ""}
        emoji="🥘"
        secondaryLine={secondaryLine}
        kcal={perServingMacro(recipe.data?.totalKcal ?? null)}
        proteinG={perServingMacro(recipe.data?.totalProteinG ?? null)}
        carbsG={perServingMacro(recipe.data?.totalCarbsG ?? null)}
        fatG={perServingMacro(recipe.data?.totalFatG ?? null)}
        ingredients={ingredients}
        instructions={recipe.data?.instructions ?? null}
        onLog={() => setSheet("log")}
        onAddToPlan={() => setSheet("plan")}
      />
      <LogMealSheetContainer
        visible={sheet === "log" && r !== null}
        item={
          r
            ? {
                kind: "recipe",
                id: r.id,
                name: r.name,
                kcal: (r.totalKcal ?? 0) / perServingDiv,
              }
            : null
        }
        onClose={onCloseSheet}
        onLogged={onLogged}
      />
      <AddToPlanSheetContainer
        visible={sheet === "plan" && r !== null}
        source={r ? { kind: "recipe", recipe: r } : null}
        onClose={onCloseSheet}
      />
    </>
  );
}
