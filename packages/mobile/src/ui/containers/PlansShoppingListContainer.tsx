import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import type {
  NutritionPlansCache,
  PlansShoppingAisle,
  PlansShoppingList,
} from "@/domain/models/nutritionPlans";
import {
  isPlanInShoppingList,
  shoppingProgress,
  visibleCoachPlans,
  visibleMyPlans,
} from "@/domain/services/nutritionPlans.service";
import {
  useNutritionPlans,
  usePlansShoppingList,
} from "@/ui/hooks/useNutritionPlans";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  PlansShoppingAddSheetPresenter,
  type PlansShoppingPlanRowVM,
} from "@/ui/presenters/fuel/PlansShoppingAddSheetPresenter";
import {
  PlansShoppingListPresenter,
  type PlansShoppingAisleVM,
  type PlansShoppingChipVM,
  type PlansShoppingView,
} from "@/ui/presenters/fuel/PlansShoppingListPresenter";

/** N23: aisles in this order; any other aisle goes last; empty ones hidden. */
export const AISLE_ORDER = [
  "Meat & fish",
  "Dairy & eggs",
  "Fruit & veg",
  "Bakery",
  "Cupboard",
  "Other",
] as const;

export function orderAisles(
  aisles: readonly PlansShoppingAisle[],
): PlansShoppingAisle[] {
  const rank = (a: string) => {
    const i = (AISLE_ORDER as readonly string[]).indexOf(a);
    return i === -1 ? AISLE_ORDER.length : i;
  };
  return aisles
    .filter((a) => a.items.length > 0)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a.aisle) - rank(y.a.aisle) || x.i - y.i)
    .map(({ a }) => a);
}

/** One chip per plan in the list, named from the phone's plans. */
export function shoppingChips(
  list: PlansShoppingList,
  cache: NutritionPlansCache,
): PlansShoppingChipVM[] {
  const names = new Map<string, string>();
  for (const p of cache.mine) names.set(p.id, p.name);
  for (const c of cache.fromCoaches) names.set(c.plan.id, c.plan.name);
  return list.plans.map((ref) => {
    if (ref.nutritionPlanId) {
      return {
        key: ref.nutritionPlanId,
        label: names.get(ref.nutritionPlanId) ?? "Plan",
      };
    }
    return { key: `mealprint-${ref.mealPlanId}`, label: "Mealprint plan" };
  });
}

/** Every plan the person can put in the list, ticked when it's in. */
export function shoppingPlanRows(
  list: PlansShoppingList | null,
  cache: NutritionPlansCache,
): PlansShoppingPlanRowVM[] {
  const mine = visibleMyPlans(cache).map((p) => ({
    id: p.id,
    name: p.name,
    sub: "Yours",
    fromCoach: false,
    included: isPlanInShoppingList(list, p.id),
  }));
  const coach = visibleCoachPlans(cache)
    .filter(
      (c) => c.status === "added" || isPlanInShoppingList(list, c.plan.id),
    )
    .map((c) => ({
      id: c.plan.id,
      name: c.plan.name,
      sub: `From ${c.coach.name}`,
      fromCoach: true,
      included: isPlanInShoppingList(list, c.plan.id),
    }));
  return [...mine, ...coach];
}

/**
 * <PlansShoppingListContainer> — N23 shopping list across every added plan
 * (PER-133). Cache-first: the last list read shows offline, ticks stay on the
 * phone, and the "+" sheet adds or takes out plans (queued when offline).
 */
export function PlansShoppingListContainer() {
  const shopping = usePlansShoppingList();
  const plans = useNutritionPlans();
  const online = useOnlineStatus();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { list, ticked } = shopping.value;
  const { refresh, toggleTick, setPlanIncluded } = shopping;

  const view: PlansShoppingView = useMemo(() => {
    if (list === null) {
      if (shopping.isLoading) return online ? "loading" : "offline";
      if (shopping.hasError) return online ? "error" : "offline";
      return "empty";
    }
    return list.plans.length === 0 ? "empty" : "list";
  }, [list, shopping.isLoading, shopping.hasError, online]);

  const aisles: PlansShoppingAisleVM[] = useMemo(() => {
    if (!list) return [];
    const on = new Set(ticked);
    return orderAisles(list.aisles).map((a) => ({
      aisle: a.aisle,
      items: a.items.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        ticked: on.has(i.id),
      })),
    }));
  }, [list, ticked]);

  const chips = useMemo(
    () => (list ? shoppingChips(list, plans.cache) : []),
    [list, plans.cache],
  );
  const rows = useMemo(
    () => shoppingPlanRows(list, plans.cache),
    [list, plans.cache],
  );
  const { done, total } = shoppingProgress(list, ticked);

  const onRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const onBack = useCallback(() => router.back(), []);
  const onAdd = useCallback(() => setSheetOpen(true), []);
  const onClose = useCallback(() => setSheetOpen(false), []);
  const onTogglePlan = useCallback(
    (planId: string, include: boolean) => {
      void setPlanIncluded(planId, include);
    },
    [setPlanIncluded],
  );

  return (
    <PlansShoppingListPresenter
      view={view}
      chips={chips}
      done={done}
      total={total}
      aisles={aisles}
      refreshing={shopping.isRefreshing}
      onRefresh={onRefresh}
      onToggle={toggleTick}
      onBack={onBack}
      onAdd={onAdd}
      onRetry={onRefresh}
      sheet={
        <PlansShoppingAddSheetPresenter
          visible={sheetOpen}
          onClose={onClose}
          plans={rows}
          onToggle={onTogglePlan}
        />
      }
    />
  );
}
