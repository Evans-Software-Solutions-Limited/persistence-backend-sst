import { styled, View, Text as TamaguiText } from "@tamagui/core";
import {
  CATEGORY_LABELS,
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  type Exercise,
} from "@/domain/models/exercise";

import { Badge } from "./Badge";
import { Column } from "./Column";
import { Row } from "./Row";
import { Text } from "./Text";

const CardFrame = styled(View, {
  backgroundColor: "$surface",
  borderRadius: "$lg",
  padding: "$base",
  borderWidth: 1,
  borderColor: "$borderColor",
  pressStyle: {
    backgroundColor: "$backgroundPress",
    opacity: 0.9,
    scale: 0.995,
  },

  variants: {
    custom: {
      true: {
        borderColor: "$primary",
      },
    },
  } as const,
});

type ExerciseCardProps = {
  exercise: Exercise;
  onPress: (id: string) => void;
  testID?: string;
};

function describeEquipment(exercise: Exercise): string {
  if (exercise.equipment.length === 0) return "Bodyweight";
  return exercise.equipment.map((e) => EQUIPMENT_LABELS[e]).join(" / ");
}

function describeMuscles(exercise: Exercise): string {
  if (exercise.primaryMuscleGroups.length === 0) return "General";
  return exercise.primaryMuscleGroups
    .map((m) => MUSCLE_GROUP_LABELS[m])
    .join(", ");
}

export function ExerciseCard({ exercise, onPress, testID }: ExerciseCardProps) {
  return (
    <CardFrame
      custom={exercise.isCustom}
      onPress={() => onPress(exercise.id)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${exercise.name}`}
      testID={testID}
    >
      <Column gap="sm">
        <Row gap="sm" justify="between">
          <View flex={1}>
            <TamaguiText
              fontFamily="$body"
              fontSize={17}
              lineHeight={22}
              fontWeight="600"
              color="$color"
              numberOfLines={1}
              testID={testID ? `${testID}-name` : undefined}
            >
              {exercise.name}
            </TamaguiText>
          </View>
          {exercise.isCustom && (
            <Badge
              label="CUSTOM"
              variant="primary"
              size="sm"
              testID={testID ? `${testID}-custom-badge` : undefined}
            />
          )}
        </Row>

        <Text variant="bodySmall" secondary numberOfLines={1}>
          {describeMuscles(exercise)}
        </Text>

        <Row gap="xs" wrap>
          <Badge
            label={CATEGORY_LABELS[exercise.category]}
            variant="info"
            size="sm"
          />
          <Badge
            label={DIFFICULTY_LABELS[exercise.difficulty]}
            variant="default"
            size="sm"
          />
        </Row>

        <Text variant="caption" muted numberOfLines={1}>
          {describeEquipment(exercise)}
        </Text>
      </Column>
    </CardFrame>
  );
}
