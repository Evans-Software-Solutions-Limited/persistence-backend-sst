import { styled, View, Text as TamaguiText } from "@tamagui/core";
import { memo } from "react";
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  type Exercise,
  type ExerciseDifficulty,
} from "@/domain/models/exercise";

/**
 * Build the labelled chip list for a muscle / equipment row.
 *
 * The adapter stamps resolved labels onto `*Labels` fields when the
 * reference-list cache is loaded — prefer those. If the cache wasn't
 * populated when the exercise was mapped (e.g. cold start before
 * reference-list fetch), fall back to the legacy enum→label map keyed
 * on the stored values. This ONLY yields a real label for legacy rows
 * that stored enum keys; UUID-valued rows without labels return the key
 * itself, which is better than an empty chip but obviously wrong — so
 * we drop those so the chip doesn't render instead of showing a raw UUID.
 */
function labelledChips(
  ids: readonly string[],
  labels: readonly string[] | undefined,
  fallbackMap: Record<string, string>,
): Array<{ key: string; label: string }> {
  // Primary path: labels populated by `SSTApiAdapter.resolveUuidsToLabels`.
  // The adapter guarantees the `labels` array is parallel-indexed with
  // `ids` (unresolved UUIDs map to empty strings rather than being
  // dropped — see adapter docstring). Pair ids↔labels BEFORE filtering
  // empties so the correct React key stays attached to each chip.
  if (labels && labels.length > 0) {
    const paired: Array<{ key: string; label: string }> = [];
    const limit = Math.min(ids.length, labels.length);
    for (let i = 0; i < limit; i++) {
      const label = labels[i];
      if (label && label.length > 0) {
        paired.push({ key: ids[i] ?? `idx-${i}`, label });
      }
    }
    return paired;
  }
  // Legacy path — ids holding enum keys from pre-M0 cached data.
  const result: Array<{ key: string; label: string }> = [];
  for (const id of ids) {
    const label = fallbackMap[id];
    if (label) result.push({ key: id, label });
  }
  return result;
}

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
 * Render up to `max` chips from a pre-built `{key, label}` list, with an
 * overflow "+N" chip when the full list is longer. Kept generic on the
 * item shape so muscle + equipment rows share one implementation.
 */
function renderChipRow(
  chips: Array<{ key: string; label: string }>,
  max: number,
  overflowLabel: (remaining: number) => string,
  testIdPrefix?: string,
) {
  if (chips.length === 0) return null;
  const visible = chips.slice(0, max);
  const remaining = chips.length - visible.length;
  return (
    <Row gap="xs" wrap testID={testIdPrefix}>
      {visible.map((chip) => (
        <OutlinedChip key={chip.key}>
          <ChipText>{chip.label}</ChipText>
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
        {renderChipRow(
          labelledChips(
            exercise.primaryMuscleGroups,
            exercise.primaryMuscleGroupLabels,
            MUSCLE_GROUP_LABELS,
          ),
          2,
          (n) => `+${n}`,
          testID ? `${testID}-muscles` : undefined,
        )}

        {/* Equipment chip row */}
        {renderChipRow(
          labelledChips(
            exercise.equipment,
            exercise.equipmentLabels,
            EQUIPMENT_LABELS,
          ),
          3,
          (n) => `+${n} more`,
          testID ? `${testID}-equipment` : undefined,
        )}
      </Column>
    </CardFrame>
  );
}

export const ExerciseCard = memo(ExerciseCardBase);
