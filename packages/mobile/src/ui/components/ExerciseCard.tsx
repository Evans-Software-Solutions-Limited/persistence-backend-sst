import { styled, View, Text as TamaguiText } from "@tamagui/core";
import { memo } from "react";
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  type EquipmentType,
  type Exercise,
  type ExerciseDifficulty,
  type MuscleGroup,
} from "@/domain/models/exercise";

import { Column } from "./Column";
import { Row } from "./Row";
import { Text } from "./Text";

/**
 * Tinted difficulty pill styling — the screen's signature element.
 *
 * Each background is the matching semantic colour at 12% alpha; the text
 * colour is a slightly lighter variant of the same hue so it reads as
 * confident (not neon) on dark surfaces. Expert uses `$primary` cyan
 * since it's the rarest tier.
 */
const DIFFICULTY_PILL: Record<
  ExerciseDifficulty,
  { bg: string; fg: string; label: string }
> = {
  beginner: {
    bg: "rgba(34, 197, 94, 0.12)",
    fg: "#4ADE80",
    label: "Beginner",
  },
  intermediate: {
    bg: "rgba(245, 158, 11, 0.12)",
    fg: "#FBBF24",
    label: "Intermediate",
  },
  advanced: {
    bg: "rgba(239, 68, 68, 0.12)",
    fg: "#F87171",
    label: "Advanced",
  },
  expert: {
    bg: "rgba(0, 212, 255, 0.12)",
    fg: "#00D4FF",
    label: "Expert",
  },
};

const CardFrame = styled(View, {
  backgroundColor: "$surface",
  borderRadius: "$lg",
  padding: "$base",
  borderWidth: 1,
  borderColor: "$borderColor",
  overflow: "hidden",
  pressStyle: {
    backgroundColor: "$backgroundPress",
    opacity: 0.92,
    scale: 0.995,
  },
});

const CustomAccent = styled(View, {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  width: 3,
  backgroundColor: "$primary",
});

const OutlinedChip = styled(View, {
  paddingHorizontal: "$sm",
  paddingVertical: 3,
  borderRadius: "$full",
  borderWidth: 1,
  borderColor: "$borderColor",
  backgroundColor: "transparent",
});

const ChipText = styled(TamaguiText, {
  fontFamily: "$body",
  fontSize: 11,
  lineHeight: 14,
  fontWeight: "500",
  letterSpacing: 0.3,
  color: "$colorSecondary",
});

type ExerciseCardProps = {
  exercise: Exercise;
  onPress: (id: string) => void;
  /**
   * Optional long-press handler. Used by the exercise list to trigger a
   * destructive-delete confirm Alert (AC 7.17). If omitted, long-press
   * falls back to the normal press handler — matches legacy behaviour
   * on non-owned rows.
   */
  onLongPress?: (id: string) => void;
  testID?: string;
};

/**
 * Render up to `max` entries from `items`, rendering an overflow "+N" chip
 * when the list is longer. Used for both muscle-group and equipment rows,
 * which follow the same shape.
 */
function renderChipRow<T>(
  items: T[],
  max: number,
  label: (item: T) => string,
  keyOf: (item: T) => string,
  overflowLabel: (remaining: number) => string,
  testIdPrefix?: string,
) {
  if (items.length === 0) return null;
  const visible = items.slice(0, max);
  const remaining = items.length - visible.length;
  return (
    <Row gap="xs" wrap testID={testIdPrefix}>
      {visible.map((item) => (
        <OutlinedChip key={keyOf(item)}>
          <ChipText>{label(item)}</ChipText>
        </OutlinedChip>
      ))}
      {remaining > 0 && (
        <OutlinedChip
          testID={testIdPrefix ? `${testIdPrefix}-overflow` : undefined}
        >
          <ChipText>{overflowLabel(remaining)}</ChipText>
        </OutlinedChip>
      )}
    </Row>
  );
}

/**
 * Memoised so `FlatList` cell-level optimisation is effective: when the
 * list presenter re-renders for unrelated reasons (search debounce,
 * `isRefreshing` flag, filter-modal state), card cells skip rendering if
 * `exercise`, `onPress`, and `testID` are unchanged. Assumes the consumer
 * passes a stable `onPress` — `ExerciseListContainer` does via useCallback
 * over the router. Cards are cheap to render individually but the screen
 * can hold 50+ at once; shallow-prop memoisation keeps pull-to-refresh and
 * filter-modal interactions at 60fps.
 */
function ExerciseCardBase({
  exercise,
  onPress,
  onLongPress,
  testID,
}: ExerciseCardProps) {
  const difficulty = DIFFICULTY_PILL[exercise.difficulty];

  return (
    <CardFrame
      onPress={() => onPress(exercise.id)}
      onLongPress={onLongPress ? () => onLongPress(exercise.id) : undefined}
      accessibilityRole="button"
      accessibilityLabel={`Open ${exercise.name}`}
      testID={testID}
    >
      {exercise.isCustom && (
        <CustomAccent testID={testID ? `${testID}-custom-accent` : undefined} />
      )}

      <Column gap="sm">
        {/* Header: title + difficulty pill */}
        <Row gap="sm" justify="between" alignItems="flex-start">
          <View flex={1} paddingRight="$sm">
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
          <View
            paddingHorizontal="$sm"
            paddingVertical={3}
            borderRadius="$full"
            backgroundColor={difficulty.bg}
            testID={testID ? `${testID}-difficulty` : undefined}
          >
            <TamaguiText
              fontFamily="$body"
              fontSize={11}
              lineHeight={14}
              fontWeight="600"
              letterSpacing={0.5}
              color={difficulty.fg}
            >
              {difficulty.label}
            </TamaguiText>
          </View>
        </Row>

        {/* Description — hidden if null */}
        {exercise.description && (
          <Text
            variant="bodySmall"
            secondary
            numberOfLines={2}
            testID={testID ? `${testID}-description` : undefined}
          >
            {exercise.description}
          </Text>
        )}

        {/* Muscle chip row */}
        {renderChipRow<MuscleGroup>(
          exercise.primaryMuscleGroups,
          2,
          (m) => MUSCLE_GROUP_LABELS[m],
          (m) => `muscle-${m}`,
          (n) => `+${n}`,
          testID ? `${testID}-muscles` : undefined,
        )}

        {/* Equipment chip row */}
        {renderChipRow<EquipmentType>(
          exercise.equipment,
          3,
          (e) => EQUIPMENT_LABELS[e],
          (e) => `equip-${e}`,
          (n) => `+${n} more`,
          testID ? `${testID}-equipment` : undefined,
        )}
      </Column>
    </CardFrame>
  );
}

export const ExerciseCard = memo(ExerciseCardBase);
