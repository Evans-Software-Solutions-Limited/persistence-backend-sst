import { useRouter } from "expo-router";
import { FilterSectionListPresenter } from "../../../../src/ui/presenters/FilterSectionListPresenter";
import { useExerciseFiltersPending } from "../../../../src/ui/hooks/useExerciseFiltersPending";
import type { CreatedByFilter } from "../../../../src/domain/models/exercise";

const CREATED_BY_LABELS: Record<CreatedByFilter, string> = {
  mine: "My Exercises",
  system: "System",
};

export default function FiltersIndexScreen() {
  const router = useRouter();
  const pending = useExerciseFiltersPending();

  return (
    <FilterSectionListPresenter
      rows={[
        {
          key: "muscles",
          label: "Muscle Groups",
          subtitle: selectionSubtitle(pending.selectionCounts.muscleGroups),
          onPress: () => router.push("/(app)/exercises/filters/muscles"),
        },
        {
          key: "equipment",
          label: "Equipment",
          subtitle: selectionSubtitle(pending.selectionCounts.equipment),
          onPress: () => router.push("/(app)/exercises/filters/equipment"),
        },
        {
          key: "difficulty",
          label: "Difficulty",
          subtitle: selectionSubtitle(pending.selectionCounts.difficulties),
          onPress: () => router.push("/(app)/exercises/filters/difficulty"),
        },
        {
          key: "created-by",
          label: "Created By",
          subtitle: pending.createdBy
            ? CREATED_BY_LABELS[pending.createdBy]
            : "All creators",
          onPress: () => router.push("/(app)/exercises/filters/created-by"),
        },
      ]}
    />
  );
}

/**
 * Uniform subtitle across axes. The legacy app uses "N selected" rather
 * than category-specific phrasing ("1 piece selected" for equipment is
 * awkward; "1 muscle group selected" is verbose). Keeping this short
 * lets the label column breathe on narrow screens.
 */
function selectionSubtitle(count: number): string {
  if (count === 0) return "Any";
  if (count === 1) return "1 selected";
  return `${count} selected`;
}
