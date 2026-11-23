import { useCallback } from "react";
import { localIdFactory } from "@/application/commands/localId";
import { USER_MEALS_MAX } from "@/domain/models/userMeals";
import {
  addUserMeal,
  renameUserMeal,
  reorderUserMeals,
} from "@/domain/services/userMeals.service";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { YourMealsSheetPresenter } from "@/ui/presenters/fuel/YourMealsSheetPresenter";

/**
 * <YourMealsSheetContainer> — root-mounted N1b (PER-132). Each rename,
 * reorder or add is saved straight away: cached and queued as one
 * `PUT /nutrition/user-meals`, so it works offline.
 */
export function YourMealsSheetContainer() {
  const sheet = useFuelSheets((s) => s.sheet);
  const close = useFuelSheets((s) => s.close);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const visible = sheet === "yourMeals";
  const { meals, isPlaceholder, save } = useUserMeals(visible);

  const onClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  const commit = useCallback(
    (next: Parameters<typeof save>[0]) => {
      void save(next).then(() => notifyMutated());
    },
    [save, notifyMutated],
  );

  return (
    <YourMealsSheetPresenter
      visible={visible}
      onClose={onClose}
      meals={meals.map((m) => ({
        id: m.id,
        name: m.name,
        sub: m.defaultKey ? "Default" : "Added by you",
      }))}
      editable={!isPlaceholder}
      full={meals.length >= USER_MEALS_MAX}
      onRename={(id, name) => commit(renameUserMeal(meals, id, name))}
      onReorder={(ids) => commit(reorderUserMeals(meals, ids))}
      onAdd={(name) =>
        commit(
          addUserMeal(meals, name, localIdFactory(), new Date().toISOString()),
        )
      }
    />
  );
}
