import { useCallback, useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { localIdFactory } from "@/application/commands/localId";
import { useNutritionPlans } from "@/ui/hooks/useNutritionPlans";
import {
  addItemToMeal,
  planItemFromRecipe,
  planItemFromSavedMeal,
  visibleMyPlans,
} from "@/domain/services/nutritionPlans.service";
import { PLAN_ITEMS_PER_MEAL_MAX } from "@/domain/models/nutritionPlans";
import type { Meal, Recipe } from "@/domain/models/nutrition";
import { AddToPlanSheetPresenter } from "@/ui/presenters/fuel/AddToPlanSheetPresenter";

/**
 * <AddToPlanSheetContainer> — N13 "Add to plan" (PER-133): adds a saved meal
 * or a recipe (one portion) to a meal of one of the person's own plans and
 * saves the plan (offline-first). Plans from coaches are read-only, so they
 * are not offered.
 */

export type AddToPlanSource =
  | { kind: "meal"; meal: Meal }
  | { kind: "recipe"; recipe: Recipe };

export type AddToPlanSheetContainerProps = {
  visible: boolean;
  source: AddToPlanSource | null;
  onClose: () => void;
};

export function AddToPlanSheetContainer({
  visible,
  source,
  onClose,
}: AddToPlanSheetContainerProps) {
  const plansState = useNutritionPlans(visible);
  const plans = useMemo(
    () => visibleMyPlans(plansState.cache),
    [plansState.cache],
  );
  const [planId, setPlanId] = useState<string | null>(null);
  const [mealId, setMealId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPlanId(null);
    setMealId(null);
  }, [visible]);

  const plan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;
  const planMeal =
    plan?.meals.find((m) => m.id === mealId) ?? plan?.meals[0] ?? null;
  const full =
    planMeal !== null && planMeal.items.length >= PLAN_ITEMS_PER_MEAL_MAX;

  const onSelectPlan = useCallback((id: string) => {
    setPlanId(id);
    setMealId(null);
  }, []);

  const onAdd = useCallback(async () => {
    if (!source || !plan || !planMeal || full || adding) return;
    setAdding(true);
    const id = `local-${localIdFactory()}`;
    const item =
      source.kind === "meal"
        ? planItemFromSavedMeal(id, source.meal, 1)
        : planItemFromRecipe(id, source.recipe, 1);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await plansState.save(addItemToMeal(plan, planMeal.id, item));
      onClose();
    } finally {
      setAdding(false);
    }
  }, [source, plan, planMeal, full, adding, plansState, onClose]);

  const itemName =
    source?.kind === "meal" ? source.meal.name : (source?.recipe.name ?? "");

  return (
    <AddToPlanSheetPresenter
      visible={visible}
      onClose={onClose}
      itemName={itemName}
      plans={plans.map((p) => ({ id: p.id, name: p.name }))}
      selectedPlanId={plan?.id ?? null}
      onSelectPlan={onSelectPlan}
      meals={(plan?.meals ?? []).map((m) => ({ id: m.id, name: m.name }))}
      selectedMealId={planMeal?.id ?? null}
      onSelectMeal={setMealId}
      note={
        full
          ? `${planMeal.name} is full. Pick another meal.`
          : plan
            ? `Adding to your ${plan.name} plan, not today's log`
            : ""
      }
      addLabel={plan ? `Add to ${plan.name}` : "Add to plan"}
      canAdd={source !== null && planMeal !== null && !full}
      adding={adding}
      onAdd={() => void onAdd()}
    />
  );
}
