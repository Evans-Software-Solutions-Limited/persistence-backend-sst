import { useCallback } from "react";
import { localIdFactory } from "@/application/commands/localId";
import { USER_MEALS_MAX, type UserMeal } from "@/domain/models/userMeals";
import {
  addUserMeal,
  renameUserMeal,
  reorderUserMeals,
} from "@/domain/services/userMeals.service";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { PlanMealsSheetPresenter } from "@/ui/presenters/fuel/plans/PlanMealsSheetPresenter";

export type PlanMealsSheetContainerProps = {
  visible: boolean;
  onClose: () => void;
  /** Ids of the Your meals this plan has. */
  isTicked: (meal: UserMeal) => boolean;
  onToggle: (meal: UserMeal, meals: readonly UserMeal[]) => void;
  /** Your meals changed (renamed, reordered or a meal added). */
  onMealsChanged?: (
    next: readonly UserMeal[],
    change:
      | { kind: "rename"; from: string; to: string }
      | { kind: "add"; meal: UserMeal }
      | { kind: "reorder" },
  ) => void;
};

/**
 * <PlanMealsSheetContainer> — N28b (PER-133). Ticks belong to the plan (the
 * caller owns them); Rename, reorder and Add a meal change Your meals itself,
 * saved straight away exactly as PER-132's Your meals sheet does.
 */
export function PlanMealsSheetContainer({
  visible,
  onClose,
  isTicked,
  onToggle,
  onMealsChanged,
}: PlanMealsSheetContainerProps) {
  const { meals, isPlaceholder, save } = useUserMeals();

  const commit = useCallback(
    (
      next: UserMeal[],
      change: Parameters<NonNullable<typeof onMealsChanged>>[1],
    ) => {
      void save(next);
      onMealsChanged?.(next, change);
    },
    [save, onMealsChanged],
  );

  return (
    <PlanMealsSheetPresenter
      visible={visible}
      onClose={onClose}
      meals={meals.map((m) => ({
        id: m.id,
        name: m.name,
        sub: m.defaultKey ? "Default" : "Added by you",
        ticked: isTicked(m),
      }))}
      editable={!isPlaceholder}
      full={meals.length >= USER_MEALS_MAX}
      onToggle={(id) => {
        const meal = meals.find((m) => m.id === id);
        if (meal) onToggle(meal, meals);
      }}
      onRename={(id, name) => {
        const before = meals.find((m) => m.id === id);
        const next = renameUserMeal(meals, id, name);
        const after = next.find((m) => m.id === id);
        if (before && after)
          commit(next, { kind: "rename", from: before.name, to: after.name });
      }}
      onReorder={(ids) =>
        commit(reorderUserMeals(meals, ids), { kind: "reorder" })
      }
      onAdd={(name) => {
        const next = addUserMeal(
          meals,
          name,
          localIdFactory(),
          new Date().toISOString(),
        );
        const added = next.find((m) => !meals.some((o) => o.id === m.id));
        if (added) commit(next, { kind: "add", meal: added });
      }}
    />
  );
}
