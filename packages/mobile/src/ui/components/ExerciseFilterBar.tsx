import { ScrollView } from "react-native";
import type {
  CreatedByFilter,
  ExerciseDifficulty,
} from "@/domain/models/exercise";
import { FilterChip } from "@/ui/components/exercises/FilterChip";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { IconFilter } from "@/ui/components/icons";

/**
 * Train > Exercises filter rail.
 * Source: ~/Downloads/handoff/design-source/prototype-hubs.jsx:107–119
 * (`TrainExercisesContent`) — a leading filter <IconBtn> (opens the advanced
 * modal; primary-dim "active" tint when advanced filters are applied) +
 * horizontally-scrolling <FilterChip>s.
 *
 * One of the curated quick-filter pills. `"all"` is mutually exclusive with
 * every other id (selecting it clears other axes; selecting any other id
 * removes `"all"`). The remaining ids split across two filter axes:
 *
 *   created_by axis: "mine" | "system"
 *   difficulty axis: "beginner" | "intermediate" | "advanced" | "expert"
 *
 * Pills within an axis OR together; pills across axes AND together. `pt` /
 * `physio` variants from the legacy app are deferred until relationship data
 * lands.
 */
export type QuickFilterId = "all" | CreatedByFilter | ExerciseDifficulty;

type QuickFilter = { id: QuickFilterId; label: string };

export const QUICK_FILTERS: readonly QuickFilter[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "My Exercises" },
  { id: "system", label: "System" },
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
  { id: "expert", label: "Expert" },
] as const;

export type ExerciseFilterBarProps = {
  /** Currently-selected quick-filter ids. Includes "all" iff nothing else is selected. */
  selectedQuickFilters: QuickFilterId[];
  /**
   * True when the filter modal has any advanced filters applied (muscle group
   * / equipment). Tints the leading filter <IconBtn> with its active state.
   */
  hasAdvancedFilters: boolean;
  onToggleQuickFilter: (id: QuickFilterId) => void;
  onOpenFilterModal: () => void;
  testID?: string;
};

export function ExerciseFilterBar({
  selectedQuickFilters,
  hasAdvancedFilters,
  onToggleQuickFilter,
  onOpenFilterModal,
  testID,
}: ExerciseFilterBarProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: 6,
        paddingHorizontal: 16,
        alignItems: "center",
      }}
      testID={testID}
    >
      <IconBtn
        icon={<IconFilter size={14} />}
        size={32}
        tone="neutral"
        active={hasAdvancedFilters}
        onPress={onOpenFilterModal}
        accessibilityLabel="Open advanced filters"
        testID="filter-modal-trigger"
      />

      {QUICK_FILTERS.map((filter) => (
        <FilterChip
          key={filter.id}
          active={selectedQuickFilters.includes(filter.id)}
          onPress={() => onToggleQuickFilter(filter.id)}
          accessibilityLabel={`${filter.label} filter`}
          testID={`quick-filter-${filter.id}`}
        >
          {filter.label}
        </FilterChip>
      ))}
    </ScrollView>
  );
}
