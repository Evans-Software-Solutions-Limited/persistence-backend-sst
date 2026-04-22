import { FilterAxisDetailPresenter } from "../../../../src/ui/presenters/FilterAxisDetailPresenter";
import { useExerciseFiltersPending } from "../../../../src/ui/hooks/useExerciseFiltersPending";
import type { CreatedByFilter } from "../../../../src/domain/models/exercise";

/**
 * Created-By axis detail screen. Short list, no search. Single-select
 * (radio) — tap the currently selected row to clear it.
 */
export default function CreatedByScreen() {
  const pending = useExerciseFiltersPending();
  const items: { key: CreatedByFilter; label: string; sublabel?: string }[] = [
    { key: "mine", label: "My Exercises", sublabel: "Exercises you created" },
    { key: "system", label: "System", sublabel: "Stock exercises" },
  ];

  return (
    <FilterAxisDetailPresenter
      items={items}
      selectedKeys={pending.createdBy ? [pending.createdBy] : []}
      onToggle={(key) => pending.selectCreatedBy(key as CreatedByFilter)}
      testID="filters-created-by"
    />
  );
}
