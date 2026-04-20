import { useMemo, useState } from "react";
import { FilterAxisDetailPresenter } from "../../../../src/ui/presenters/FilterAxisDetailPresenter";
import { useExerciseFiltersPending } from "../../../../src/ui/hooks/useExerciseFiltersPending";
import { useReferenceLists } from "../../../../src/ui/hooks/useReferenceLists";
import {
  EQUIPMENT_TYPES,
  EQUIPMENT_LABELS,
  type EquipmentType,
} from "../../../../src/domain/models/exercise";

/**
 * Equipment axis detail screen. Same shape as muscles — reference-list
 * cache preferred; domain enum fallback.
 */
export default function EquipmentScreen() {
  const pending = useExerciseFiltersPending();
  const { equipment: refEntries } = useReferenceLists();
  const [search, setSearch] = useState("");

  const items = useMemo(() => {
    if (refEntries.length > 0) {
      return refEntries
        .filter((entry): entry is typeof entry & { name: EquipmentType } =>
          (EQUIPMENT_TYPES as readonly string[]).includes(entry.name),
        )
        .map((entry) => ({
          key: entry.name,
          label: entry.displayName ?? entry.name,
        }));
    }
    return EQUIPMENT_TYPES.map((key) => ({
      key,
      label: EQUIPMENT_LABELS[key],
    }));
  }, [refEntries]);

  return (
    <FilterAxisDetailPresenter
      items={items}
      selectedKeys={pending.equipment}
      onToggle={(key) => pending.toggleEquipment(key as EquipmentType)}
      searchable
      searchPlaceholder="Search equipment"
      searchValue={search}
      onSearchChange={setSearch}
      testID="filters-equipment"
    />
  );
}
