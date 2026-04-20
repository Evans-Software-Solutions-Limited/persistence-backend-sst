import { useMemo, useState } from "react";
import { FilterAxisDetailPresenter } from "../../../../src/ui/presenters/FilterAxisDetailPresenter";
import { useExerciseFiltersPending } from "../../../../src/ui/hooks/useExerciseFiltersPending";
import { useReferenceLists } from "../../../../src/ui/hooks/useReferenceLists";
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
} from "../../../../src/domain/models/exercise";

/**
 * Muscle Groups axis detail screen.
 *
 * Items are seeded from the reference-list cache when populated (backend
 * display names); falls back to the domain's hardcoded label map when
 * the cache is empty (first-launch offline scenario). Selection uses
 * enum strings — the adapter resolves them to UUIDs at the wire boundary.
 */
export default function MusclesScreen() {
  const pending = useExerciseFiltersPending();
  const { muscleGroups: refEntries } = useReferenceLists();
  const [search, setSearch] = useState("");

  const items = useMemo(() => {
    // Prefer the backend catalog when populated.
    if (refEntries.length > 0) {
      return refEntries
        .filter((entry): entry is typeof entry & { name: MuscleGroup } =>
          (MUSCLE_GROUPS as readonly string[]).includes(entry.name),
        )
        .map((entry) => ({
          key: entry.name,
          label: entry.displayName ?? entry.name,
        }));
    }
    // Fallback: iterate the domain enum with the hardcoded label map.
    return MUSCLE_GROUPS.map((key) => ({
      key,
      label: MUSCLE_GROUP_LABELS[key],
    }));
  }, [refEntries]);

  return (
    <FilterAxisDetailPresenter
      items={items}
      selectedKeys={pending.muscleGroups}
      onToggle={(key) => pending.toggleMuscleGroup(key as MuscleGroup)}
      searchable
      searchPlaceholder="Search muscle groups"
      searchValue={search}
      onSearchChange={setSearch}
      testID="filters-muscles"
    />
  );
}
