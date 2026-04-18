import { styled, View, Text as TamaguiText } from "@tamagui/core";
import { ScrollView } from "react-native";
import {
  CATEGORY_LABELS,
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  EXERCISE_CATEGORIES,
  EXERCISE_DIFFICULTIES,
  EQUIPMENT_TYPES,
  type EquipmentType,
  type ExerciseCategory,
  type ExerciseDifficulty,
} from "@/domain/models/exercise";

import { Column } from "./Column";
import { Row } from "./Row";
import { Text } from "./Text";

const Chip = styled(View, {
  paddingHorizontal: "$md",
  paddingVertical: "$xs",
  borderRadius: "$full",
  borderWidth: 1,
  borderColor: "$borderColor",
  backgroundColor: "$surfaceSecondary",

  pressStyle: {
    opacity: 0.8,
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
      true: {
        color: "$colorInverse",
      },
    },
  } as const,
});

const ClearButton = styled(View, {
  paddingHorizontal: "$md",
  paddingVertical: "$xs",
  borderRadius: "$full",
  backgroundColor: "transparent",

  pressStyle: {
    opacity: 0.7,
  },
});

type ExerciseFilterBarProps = {
  category: ExerciseCategory | null;
  difficulty: ExerciseDifficulty | null;
  equipment: EquipmentType[];
  hasActiveFilters: boolean;
  onSelectCategory: (category: ExerciseCategory | null) => void;
  onSelectDifficulty: (difficulty: ExerciseDifficulty | null) => void;
  onToggleEquipment: (equipment: EquipmentType) => void;
  onClearFilters: () => void;
  testID?: string;
};

export function ExerciseFilterBar({
  category,
  difficulty,
  equipment,
  hasActiveFilters,
  onSelectCategory,
  onSelectDifficulty,
  onToggleEquipment,
  onClearFilters,
  testID,
}: ExerciseFilterBarProps) {
  return (
    <Column gap="sm" testID={testID}>
      <Row gap="sm" justify="between">
        <Text variant="label" secondary>
          FILTERS
        </Text>
        {hasActiveFilters && (
          <ClearButton
            onPress={onClearFilters}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            testID={testID ? `${testID}-clear` : "filter-bar-clear"}
          >
            <Text variant="caption" color="$primary" fontWeight="600">
              Clear all
            </Text>
          </ClearButton>
        )}
      </Row>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 16 }}
        testID={testID ? `${testID}-category-scroll` : undefined}
      >
        {EXERCISE_CATEGORIES.map((cat) => {
          const active = category === cat;
          return (
            <Chip
              key={`cat-${cat}`}
              active={active}
              onPress={() => onSelectCategory(active ? null : cat)}
              accessibilityRole="button"
              accessibilityLabel={`${CATEGORY_LABELS[cat]} category filter`}
              accessibilityState={{ selected: active }}
              testID={`filter-category-${cat}`}
            >
              <ChipText active={active}>{CATEGORY_LABELS[cat]}</ChipText>
            </Chip>
          );
        })}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 16 }}
        testID={testID ? `${testID}-difficulty-scroll` : undefined}
      >
        {EXERCISE_DIFFICULTIES.map((diff) => {
          const active = difficulty === diff;
          return (
            <Chip
              key={`diff-${diff}`}
              active={active}
              onPress={() => onSelectDifficulty(active ? null : diff)}
              accessibilityRole="button"
              accessibilityLabel={`${DIFFICULTY_LABELS[diff]} difficulty filter`}
              accessibilityState={{ selected: active }}
              testID={`filter-difficulty-${diff}`}
            >
              <ChipText active={active}>{DIFFICULTY_LABELS[diff]}</ChipText>
            </Chip>
          );
        })}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 16 }}
        testID={testID ? `${testID}-equipment-scroll` : undefined}
      >
        {EQUIPMENT_TYPES.map((eq) => {
          const active = equipment.includes(eq);
          return (
            <Chip
              key={`eq-${eq}`}
              active={active}
              onPress={() => onToggleEquipment(eq)}
              accessibilityRole="button"
              accessibilityLabel={`${EQUIPMENT_LABELS[eq]} equipment filter`}
              accessibilityState={{ selected: active }}
              testID={`filter-equipment-${eq}`}
            >
              <ChipText active={active}>{EQUIPMENT_LABELS[eq]}</ChipText>
            </Chip>
          );
        })}
      </ScrollView>
    </Column>
  );
}
