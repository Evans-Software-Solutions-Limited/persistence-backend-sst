import { Ionicons } from "@expo/vector-icons";
import { styled, View, Text as TamaguiText } from "@tamagui/core";
import { ScrollView } from "react-native";
import type {
  CreatedByFilter,
  ExerciseDifficulty,
} from "@/domain/models/exercise";

/**
 * One of the curated quick-filter pills. `"all"` is mutually exclusive
 * with every other id (selecting it clears other axes; selecting any
 * other id removes `"all"`). The remaining ids split across two filter
 * axes under the hood:
 *
 *   created_by axis: "mine" | "system"
 *   difficulty axis: "beginner" | "intermediate" | "advanced" | "expert"
 *
 * Pills within an axis OR together; pills across axes AND together.
 *
 * `pt` / `physio` variants from the legacy app are deferred until user
 * relationship data lands.
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

const Pill = styled(View, {
  paddingHorizontal: "$md",
  paddingVertical: "$xs",
  borderRadius: "$full",
  borderWidth: 1,
  borderColor: "$borderColor",
  backgroundColor: "$surfaceSecondary",
  minHeight: 32,
  justifyContent: "center",

  pressStyle: {
    opacity: 0.85,
    scale: 0.97,
  },

  variants: {
    active: {
      true: {
        backgroundColor: "$primary",
        borderColor: "$primary",
      },
    },
  } as const,
});

const PillText = styled(TamaguiText, {
  fontFamily: "$body",
  fontSize: 13,
  lineHeight: 18,
  fontWeight: "600",
  color: "$colorSecondary",

  variants: {
    active: {
      true: { color: "$colorInverse" },
    },
  } as const,
});

const FilterIconPill = styled(View, {
  width: 40,
  height: 32,
  borderRadius: "$full",
  borderWidth: 1,
  borderColor: "$borderColor",
  backgroundColor: "$surfaceSecondary",
  alignItems: "center",
  justifyContent: "center",

  pressStyle: {
    opacity: 0.85,
    scale: 0.97,
  },
});

const ActiveDot = styled(View, {
  position: "absolute",
  top: -2,
  right: -2,
  width: 8,
  height: 8,
  borderRadius: "$full",
  backgroundColor: "$primary",
  borderWidth: 1,
  borderColor: "$background",
});

export type ExerciseFilterBarProps = {
  /** Currently-selected quick-filter ids. Includes "all" iff nothing else is selected. */
  selectedQuickFilters: QuickFilterId[];
  /**
   * True when the filter modal has any advanced filters applied
   * (muscle group / equipment). Drives the `$primary` dot on the
   * leading filter-icon pill.
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
        gap: 8,
        paddingHorizontal: 16,
        alignItems: "center",
      }}
      testID={testID}
    >
      <FilterIconPill
        onPress={onOpenFilterModal}
        accessibilityRole="button"
        accessibilityLabel="Open advanced filters"
        testID="filter-modal-trigger"
      >
        <Ionicons name="options-outline" size={18} color="#E8E8EC" />
        {hasAdvancedFilters && <ActiveDot testID="filter-modal-trigger-dot" />}
      </FilterIconPill>

      {QUICK_FILTERS.map((filter) => {
        const active = selectedQuickFilters.includes(filter.id);
        return (
          <Pill
            key={filter.id}
            active={active}
            onPress={() => onToggleQuickFilter(filter.id)}
            accessibilityRole="button"
            accessibilityLabel={`${filter.label} filter`}
            accessibilityState={{ selected: active }}
            testID={`quick-filter-${filter.id}`}
          >
            <PillText active={active}>{filter.label}</PillText>
          </Pill>
        );
      })}
    </ScrollView>
  );
}
