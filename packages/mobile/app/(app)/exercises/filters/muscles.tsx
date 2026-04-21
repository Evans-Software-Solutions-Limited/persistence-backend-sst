import { useMemo, useState } from "react";
import { FilterAxisDetailPresenter } from "../../../../src/ui/presenters/FilterAxisDetailPresenter";
import { useExerciseFiltersPending } from "../../../../src/ui/hooks/useExerciseFiltersPending";
import { useReferenceLists } from "../../../../src/ui/hooks/useReferenceLists";

/**
 * Muscle Groups axis detail screen.
 *
 * Items come from the reference-list cache — backed by Supabase's
 * `muscle_groups` table. Each row's UUID is the selection key; the
 * visible label is `displayName ?? name` (the DB uses title-case names
 * like "Shoulders", which are fine to display as-is).
 *
 * Pre-M0 the screen filtered `refEntries` against the hardcoded
 * `MUSCLE_GROUPS` enum union, which silently nuked every entry because
 * the enum is lowercase ("shoulders") and the DB is title-case
 * ("Shoulders"). That produced the infamous "No matches" empty-state
 * even when the reference list was fully loaded.
 */
export default function MusclesScreen() {
  const pending = useExerciseFiltersPending();
  const { muscleGroups: refEntries } = useReferenceLists();
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
      selectedKeys={pending.muscleGroups}
      onToggle={(key) => pending.toggleMuscleGroup(key)}
      searchable
      searchPlaceholder="Search muscle groups"
      searchValue={search}
      onSearchChange={setSearch}
      testID="filters-muscles"
    />
  );
}
