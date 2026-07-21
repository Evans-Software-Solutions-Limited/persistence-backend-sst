import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import { useAddRecipeMenu } from "@/state/add-recipe-menu";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { perServingDivisor } from "@/domain/services";
import {
  RecipesLibraryPresenter,
  type LibraryTab,
  type MealRowVM,
  type RecipeRowVM,
} from "@/ui/presenters/RecipesLibraryPresenter";

/**
 * <RecipesLibraryContainer> — Fuel → Recipes library (recipes.jsx
 * `RecipesScreen`). Wires the cache-first recipe/meal reads + local
 * tab/search state into the pure presenter. The "+" opens the 4-path
 * <AddRecipeMenuContainer> sheet (Recipes AI PR3) — replacing PR1's direct
 * push to Save-a-meal.
 *
 * `GET /meals` (and the cached list it seeds) omits item detail — see
 * `mealsListHandler.ts`'s "cards; items omitted" contract — so a meal row's
 * item summary can only be resolved when the cache already holds the item's
 * linked food/recipe names (true immediately after this PR's own
 * Save-a-meal flow; not for older meals synced down from the list).
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <RecipesLibraryContainer>
 */

function mealItemsSummary(
  meal: {
    items: readonly { foodId: string | null; recipeId: string | null }[];
  },
  resolveName: (
    foodId: string | null,
    recipeId: string | null,
  ) => string | null,
): string | null {
  if (meal.items.length === 0) return null;
  const names = meal.items
    .map((item) => resolveName(item.foodId, item.recipeId))
    .filter((n): n is string => n !== null);
  if (names.length === 0) return null;
  return names.join(" + ");
}

export function RecipesLibraryContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const recipes = useGetRecipes();
  const meals = useGetMeals();

  const [tab, setTab] = useState<LibraryTab>("Meals");
  const [query, setQuery] = useState("");

  const resolveItemName = useCallback(
    (foodId: string | null, recipeId: string | null): string | null => {
      if (foodId) return storage.getCachedFoodById(foodId)?.name ?? null;
      if (recipeId && userId) {
        return storage.getCachedRecipe(userId, recipeId)?.name ?? null;
      }
      return null;
    },
    [storage, userId],
  );

  const mealRows: MealRowVM[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (meals.data ?? [])
      .filter((m) => q.length === 0 || m.name.toLowerCase().includes(q))
      .map((m) => ({
        id: m.id,
        name: m.name,
        kcal: m.totalKcal,
        itemsSummary: mealItemsSummary(m, resolveItemName),
      }));
  }, [meals.data, query, resolveItemName]);

  const recipeRows: RecipeRowVM[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (recipes.data ?? [])
      .filter((r) => q.length === 0 || r.name.toLowerCase().includes(q))
      .map((r) => {
        const servingsLabel = `${r.servings} serving${r.servings === 1 ? "" : "s"}`;
        const sourceLabel =
          r.sourceUrl !== null
            ? r.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]
            : r.source === "manual"
              ? "My recipe"
              : r.source;
        // Recipe cards show PER-SERVING macros (whole-recipe `total_*` ÷
        // servings, guarded) — a saved MEAL preset stays whole (one serving),
        // so this division only applies to the Recipes tab's rows.
        const div = perServingDivisor(r.servings);
        const perServing = (total: number | null): number | null =>
          total === null ? null : Math.round(total / div);
        return {
          id: r.id,
          name: r.name,
          kcal: perServing(r.totalKcal),
          proteinG: perServing(r.totalProteinG),
          carbsG: perServing(r.totalCarbsG),
          fatG: perServing(r.totalFatG),
          secondaryLine: `${servingsLabel} · ${sourceLabel}`,
        };
      });
  }, [recipes.data, query]);

  // `useGetMeals`/`useGetRecipes` type their data as `T[]` (never `null`) and
  // always mark the read stale to force a background refresh, so "do we
  // already have something real to show" can't be read off `data === null`
  // or `isStale` the way FuelToday/Programs (nullable single-payload reads)
  // do — the underlying store always answers with an (possibly empty) array.
  // Whether there's at least one cached ROW (unfiltered by the search box) is
  // the honest signal: with real rows already in hand, a loading/failed
  // background refresh degrades gracefully to showing them rather than
  // blocking the whole screen.
  const hasData =
    tab === "Meals"
      ? (meals.data?.length ?? 0) > 0
      : (recipes.data?.length ?? 0) > 0;
  const isRefreshing =
    tab === "Meals" ? meals.isRefreshing : recipes.isRefreshing;
  const isLoading =
    tab === "Meals"
      ? meals.isRefreshing || (meals.isStale && meals.error === null)
      : recipes.isRefreshing || (recipes.isStale && recipes.error === null);
  const error = tab === "Meals" ? meals.error : recipes.error;

  const onRefresh = useCallback(() => {
    void (tab === "Meals" ? meals.refresh() : recipes.refresh());
  }, [tab, meals, recipes]);

  const openAddRecipeMenu = useAddRecipeMenu((s) => s.openMenu);

  const onBack = useCallback(() => router.back(), []);
  const onAdd = useCallback(() => {
    openAddRecipeMenu();
  }, [openAddRecipeMenu]);
  const onSelectMeal = useCallback((id: string) => {
    router.push(`/(app)/fuel/meal/${id}` as never);
  }, []);
  const onSelectRecipe = useCallback((id: string) => {
    router.push(`/(app)/fuel/recipe/${id}` as never);
  }, []);

  return (
    <RecipesLibraryPresenter
      tab={tab}
      onTabChange={setTab}
      query={query}
      onQueryChange={setQuery}
      meals={mealRows}
      recipes={recipeRows}
      hasData={hasData}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      error={error}
      onRefresh={onRefresh}
      onSelectMeal={onSelectMeal}
      onSelectRecipe={onSelectRecipe}
      onAdd={onAdd}
      onBack={onBack}
    />
  );
}
