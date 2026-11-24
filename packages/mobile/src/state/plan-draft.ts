import { create } from "zustand";
import type { NutritionPlan, PlanItem } from "@/domain/models/nutritionPlans";
import {
  addItemToMeal,
  isPlanMealFull,
  recomputePlan,
  removeItem,
  replaceItem,
} from "@/domain/services/nutritionPlans.service";

/**
 * usePlanDraft — the plan being built (N28 → N29/N32) or edited (N34)
 * (PER-133). It lives outside the screens so the Add to a meal page
 * (`fuel/plan-add`, N30) can add into the same draft and the builder picks
 * the change up when it comes back into view.
 *
 * Nothing here saves or logs: the builder sends the draft through
 * `useNutritionPlans().create` / `.save` when the person taps Save.
 */

export type PlanDraftMode = "new" | "edit";

export interface PlanDraftState {
  mode: PlanDraftMode | null;
  draft: NutritionPlan | null;
  /** Start a new draft (or open a plan for editing). */
  start: (mode: PlanDraftMode, plan: NutritionPlan) => void;
  /** Replace the whole draft (meal ticks, a copied day). */
  setDraft: (plan: NutritionPlan) => void;
  rename: (name: string) => void;
  addItems: (mealId: string, items: readonly PlanItem[]) => void;
  replaceItem: (mealId: string, item: PlanItem) => void;
  removeItem: (mealId: string, itemId: string) => void;
  /** Move an item to another meal (the amount sheet's Meal row). */
  moveItem: (fromMealId: string, toMealId: string, item: PlanItem) => void;
  clear: () => void;
}

export const usePlanDraft = create<PlanDraftState>((set) => {
  const edit = (fn: (plan: NutritionPlan) => NutritionPlan) =>
    set((s) => (s.draft ? { draft: fn(s.draft) } : {}));
  return {
    mode: null,
    draft: null,
    start: (mode, plan) => set({ mode, draft: recomputePlan(plan) }),
    setDraft: (plan) => set({ draft: recomputePlan(plan) }),
    rename: (name) => edit((p) => ({ ...p, name })),
    addItems: (mealId, items) =>
      edit((p) => items.reduce((acc, it) => addItemToMeal(acc, mealId, it), p)),
    replaceItem: (mealId, item) => edit((p) => replaceItem(p, mealId, item)),
    removeItem: (mealId, itemId) => edit((p) => removeItem(p, mealId, itemId)),
    moveItem: (fromMealId, toMealId, item) =>
      edit((p) =>
        fromMealId === toMealId
          ? replaceItem(p, fromMealId, item)
          : isPlanMealFull(p, toMealId)
            ? // A full meal can't take it: keep it where it was.
              replaceItem(p, fromMealId, item)
            : addItemToMeal(removeItem(p, fromMealId, item.id), toMealId, item),
      ),
    clear: () => set({ mode: null, draft: null }),
  };
});
