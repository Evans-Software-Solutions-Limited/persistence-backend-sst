import { styled, View, Text as TamaguiText } from "@tamagui/core";
import { memo } from "react";
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  type Exercise,
  type ExerciseDifficulty,
} from "@/domain/models/exercise";

import { Column } from "./Column";
import { Row } from "./Row";
import { Text } from "./Text";

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
): { key: string; label: string }[] {
  // Primary path: labels populated by `SSTApiAdapter.resolveUuidsToLabels`.
  // The adapter guarantees the `labels` array is parallel-indexed with
  // `ids` (unresolved UUIDs map to empty strings rather than being
  // dropped — see adapter docstring). Pair ids↔labels BEFORE filtering
  // empties so the correct React key stays attached to each chip.
  if (labels && labels.length > 0) {
    const paired: { key: string; label: string }[] = [];
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
  const result: { key: string; label: string }[] = [];
  for (const id of ids) {
    const label = fallbackMap[id];
    if (label) result.push({ key: id, label });
  }
  return result;
}

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
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: "$full",
  borderWidth: 1,
  borderColor: "$borderColor",
  backgroundColor: "transparent",

  variants: {
    // Muscle chips use the surface-secondary fill + brighter text so
    // they read as the row's primary tag, with equipment chips
    // (outline-only) playing the supporting role on the same line.
    kind: {
      muscle: {
        backgroundColor: "$surfaceSecondary",
        borderColor: "transparent",
      },
      equipment: {
        backgroundColor: "transparent",
      },
    },
  } as const,
});

const ChipText = styled(TamaguiText, {
  fontFamily: "$body",
  fontSize: 12,
  lineHeight: 16,
  fontWeight: "500",
  letterSpacing: 0.2,

  variants: {
    kind: {
      muscle: { color: "$color", fontWeight: "600" },
      equipment: { color: "$colorSecondary" },
    },
  } as const,

  defaultVariants: {
    kind: "equipment",
  },
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

type ChipKind = "muscle" | "equipment";

type CardChip = {
  key: string;
  label: string;
  kind: ChipKind;
};

/**
 * Cap each chip family before merging so a 5-equipment exercise can't
 * crowd the muscle chips off the row. Overflow chips render in-place
 * per-family ("+N" for muscles, "+N more" for equipment) to keep the
 * row scannable.
 */
function buildChipList(
  muscleChips: { key: string; label: string }[],
  equipmentChips: { key: string; label: string }[],
  muscleMax: number,
  equipmentMax: number,
): CardChip[] {
  const out: CardChip[] = [];
  const muscleVisible = muscleChips.slice(0, muscleMax);
  for (const chip of muscleVisible) {
    out.push({ key: `m-${chip.key}`, label: chip.label, kind: "muscle" });
  }
  const muscleOverflow = muscleChips.length - muscleVisible.length;
  if (muscleOverflow > 0) {
    out.push({
      key: "m-overflow",
      label: `+${muscleOverflow}`,
      kind: "muscle",
    });
  }
  const equipmentVisible = equipmentChips.slice(0, equipmentMax);
  for (const chip of equipmentVisible) {
    out.push({
      key: `e-${chip.key}`,
      label: chip.label,
      kind: "equipment",
    });
  }
  const equipmentOverflow = equipmentChips.length - equipmentVisible.length;
  if (equipmentOverflow > 0) {
    out.push({
      key: "e-overflow",
      label: `+${equipmentOverflow} more`,
      kind: "equipment",
    });
  }
  return out;
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

        {/* Combined muscle + equipment chip row — both groups land on
            one wrap-row to keep the card scannable and consistent
            (legacy split rendered them as two separate rows, which
            read as unrelated). Muscles render filled, equipment
            outlined-only, so the visual hierarchy still distinguishes
            them at a glance. */}
        {(() => {
          const muscleChips = labelledChips(
            exercise.primaryMuscleGroups,
            exercise.primaryMuscleGroupLabels,
            MUSCLE_GROUP_LABELS,
          );
          const equipmentChips = labelledChips(
            exercise.equipment,
            exercise.equipmentLabels,
            EQUIPMENT_LABELS,
          );
          const merged = buildChipList(muscleChips, equipmentChips, 2, 3);
          if (merged.length === 0) return null;
          return (
            <Row gap="xs" wrap testID={testID ? `${testID}-tags` : undefined}>
              {merged.map((chip) => (
                <OutlinedChip key={chip.key} kind={chip.kind}>
                  <ChipText kind={chip.kind}>{chip.label}</ChipText>
                </OutlinedChip>
              ))}
            </Row>
          );
        })()}
      </Column>
    </CardFrame>
  );
}

export const ExerciseCard = memo(ExerciseCardBase);
