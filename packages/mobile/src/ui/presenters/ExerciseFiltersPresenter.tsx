import { View, Text as TamaguiText, styled } from "@tamagui/core";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  EQUIPMENT_TYPES,
  EXERCISE_DIFFICULTIES,
  type EquipmentType,
  type ExerciseDifficulty,
  type MuscleGroup,
} from "@/domain/models/exercise";
import { Button, Column, MuscleGroupPicker, Row, Text } from "@/ui/components";

const Chip = styled(View, {
  paddingHorizontal: "$md",
  paddingVertical: "$xs",
  borderRadius: "$full",
  borderWidth: 1,
  borderColor: "$borderColor",
  backgroundColor: "$surfaceSecondary",
  minHeight: 36,
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

const ChipText = styled(TamaguiText, {
  fontFamily: "$body",
  fontSize: 13,
  lineHeight: 18,
  fontWeight: "600",
  color: "$color",

  variants: {
    active: {
      true: { color: "$colorInverse" },
    },
  } as const,
});

export type ExerciseFiltersPresenterProps = {
  difficulties: ExerciseDifficulty[];
  equipment: EquipmentType[];
  muscleGroups: MuscleGroup[];
  /** Live count of exercises matching the currently-pending filter state. */
  matchCount: number;
  onToggleDifficulty: (difficulty: ExerciseDifficulty) => void;
  onToggleEquipment: (equipment: EquipmentType) => void;
  onToggleMuscleGroup: (group: MuscleGroup) => void;
  onClear: () => void;
  onApply: () => void;
  onClose: () => void;
};

export function ExerciseFiltersPresenter({
  difficulties,
  equipment,
  muscleGroups,
  matchCount,
  onToggleDifficulty,
  onToggleEquipment,
  onToggleMuscleGroup,
  onClear,
  onApply,
  onClose,
}: ExerciseFiltersPresenterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      flex={1}
      backgroundColor="$background"
      testID="exercise-filters-screen"
    >
      {/* Modal header — close (left) + title (centered) + clear (right) */}
      <Row
        gap="sm"
        justify="between"
        paddingHorizontal="$base"
        paddingVertical="$md"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
      >
        <View
          onPress={onClose}
          padding="$xs"
          accessibilityRole="button"
          accessibilityLabel="Close filters"
          testID="filters-close"
        >
          <Text variant="bodySmall" color="$colorSecondary">
            Close
          </Text>
        </View>
        <Text variant="h4">Filters</Text>
        <View
          onPress={onClear}
          padding="$xs"
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          testID="filters-clear"
        >
          <Text variant="bodySmall" color="$primary" fontWeight="600">
            Clear
          </Text>
        </View>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: 24,
          gap: 32,
        }}
      >
        {/* Difficulty — 4 pills in a single row */}
        <Column gap="md">
          <Text variant="label" secondary>
            DIFFICULTY
          </Text>
          <Row gap="sm" wrap>
            {EXERCISE_DIFFICULTIES.map((d) => {
              const active = difficulties.includes(d);
              return (
                <Chip
                  key={d}
                  active={active}
                  onPress={() => onToggleDifficulty(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${DIFFICULTY_LABELS[d]} difficulty`}
                  accessibilityState={{ selected: active }}
                  testID={`filters-difficulty-${d}`}
                >
                  <ChipText active={active}>{DIFFICULTY_LABELS[d]}</ChipText>
                </Chip>
              );
            })}
          </Row>
        </Column>

        {/* Equipment — wrap grid of chips */}
        <Column gap="md">
          <Text variant="label" secondary>
            EQUIPMENT
          </Text>
          <Row gap="sm" wrap>
            {EQUIPMENT_TYPES.map((e) => {
              const active = equipment.includes(e);
              return (
                <Chip
                  key={e}
                  active={active}
                  onPress={() => onToggleEquipment(e)}
                  accessibilityRole="button"
                  accessibilityLabel={`${EQUIPMENT_LABELS[e]} equipment`}
                  accessibilityState={{ selected: active }}
                  testID={`filters-equipment-${e}`}
                >
                  <ChipText active={active}>{EQUIPMENT_LABELS[e]}</ChipText>
                </Chip>
              );
            })}
          </Row>
        </Column>

        {/* Muscle groups — reuse the existing picker */}
        <MuscleGroupPicker
          selected={muscleGroups}
          onToggle={onToggleMuscleGroup}
          testID="filters-muscle-picker"
        />
      </ScrollView>

      {/* Sticky apply bar */}
      <View
        flexDirection="row"
        gap="$sm"
        paddingHorizontal="$base"
        paddingTop="$md"
        paddingBottom={Math.max(insets.bottom, 16)}
        borderTopWidth={1}
        borderTopColor="$borderColor"
        backgroundColor="$background"
      >
        <View flex={1}>
          <Button
            label="Clear"
            onPress={onClear}
            variant="ghost"
            fullWidth
            testID="filters-clear-button"
          />
        </View>
        <View flex={2}>
          <Button
            label={buildApplyLabel(matchCount)}
            onPress={onApply}
            variant="primary"
            fullWidth
            testID="filters-apply-button"
          />
        </View>
      </View>
    </View>
  );
}

function buildApplyLabel(count: number): string {
  if (count === 1) return "Show 1 exercise";
  return `Show ${count} exercises`;
}
