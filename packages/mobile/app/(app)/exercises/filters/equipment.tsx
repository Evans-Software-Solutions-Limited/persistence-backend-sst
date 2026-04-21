import { useMemo, useState } from "react";
import { FilterAxisDetailPresenter } from "../../../../src/ui/presenters/FilterAxisDetailPresenter";
import { useExerciseFiltersPending } from "../../../../src/ui/hooks/useExerciseFiltersPending";
import { useReferenceLists } from "../../../../src/ui/hooks/useReferenceLists";

/**
 * Equipment axis detail screen. Same shape as muscles — reference-list
 * entries are the source of truth, UUID-keyed selection, label from
 * `displayName ?? name`. See muscles.tsx for the pre-M0 enum bug.
 */
export default function EquipmentScreen() {
  const pending = useExerciseFiltersPending();
  const { equipment: refEntries } = useReferenceLists();
  const [search, setSearch] = useState("");

  const items = useMemo(
    () =>
      refEntries.map((entry) => ({
        key: entry.id,
        label: entry.displayName ?? entry.name,
      })),
    [refEntries],
  );

  return (
    <FilterAxisDetailPresenter
      items={items}
      selectedKeys={pending.equipment}
      onToggle={(key) => pending.toggleEquipment(key)}
      searchable
      searchPlaceholder="Search equipment"
      searchValue={search}
      onSearchChange={setSearch}
      testID="filters-equipment"
    />
  );
}
