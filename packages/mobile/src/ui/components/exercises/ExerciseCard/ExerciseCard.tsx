import { Text, View } from "@tamagui/core";
import { memo } from "react";
import { Pressable } from "react-native";

import type { Exercise, ExerciseDifficulty } from "@/domain/models/exercise";
import { Pill } from "@/ui/components/foundation/Pill";
import type { PillTone } from "@/ui/components/foundation/tones";

/**
 * <ExerciseCard> — Train > Exercises library card.
 * Source: ~/Downloads/handoff/design-source/prototype-hubs.jsx:128–143
 * (`TrainExercisesContent`) + screens/library.jsx:145–165.
 *
 * `$surface2` card with a fixed 3pt `$primary` left-border (the prototype's
 * border is always primary — NOT muscle-derived, which also sidesteps the
 * UUID-vs-enum issue). Header = name + difficulty pill; body = description;
 * footer = primary-muscle pill + neutral equipment pills. Muscle/equipment
 * text reads the adapter-resolved `*Labels` (the raw groups are DB UUIDs).
 *
 * This is the LIBRARY card — distinct from the root `@/ui/components/
 * ExerciseCard` still used by the active-session surfaces.
 */

const DIFFICULTY_TONE: Record<ExerciseDifficulty, PillTone> = {
  beginner: "success",
  intermediate: "gold",
  advanced: "error",
  expert: "error",
};

/** Capitalise the enum for the pill label (e.g. "beginner" -> "Beginner");
 * the <Pill> renders it uppercase visually. */
function difficultyLabel(difficulty: ExerciseDifficulty): string {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

/** Pressable feedback — dim to 0.9 while pressed. Extracted so both press
 * branches are unit-testable. */
export const cardPressStyle = ({ pressed }: { pressed: boolean }) => ({
  opacity: pressed ? 0.9 : 1,
});

export type ExerciseCardProps = {
  exercise: Exercise;
  onPress: (id: string) => void;
  /** Owner-only long-press → destructive-delete confirm (AC 7.17). */
  onLongPress?: (id: string) => void;
  testID?: string;
};

function ExerciseCardBase({
  exercise,
  onPress,
  onLongPress,
  testID,
}: ExerciseCardProps) {
  const muscle = exercise.primaryMuscleGroupLabels?.[0];
  const equipment = (exercise.equipmentLabels ?? []).slice(0, 2);
  const hasTags = Boolean(muscle) || equipment.length > 0;

  return (
    <Pressable
      onPress={() => onPress(exercise.id)}
      onLongPress={onLongPress ? () => onLongPress(exercise.id) : undefined}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Open ${exercise.name}`}
      style={cardPressStyle}
    >
      <View
        backgroundColor="$surface2"
        borderWidth={1}
        borderColor="$border"
        borderLeftWidth={3}
        borderLeftColor="$primary"
        borderRadius={14}
        padding={14}
      >
        <View
          flexDirection="row"
          justifyContent="space-between"
          alignItems="flex-start"
          gap={8}
        >
          <Text
            flex={1}
            fontFamily="$display"
            fontWeight="700"
            fontSize={15}
            color="$text"
            numberOfLines={1}
            testID={testID ? `${testID}-name` : undefined}
          >
            {exercise.name}
          </Text>
          <Pill tone={DIFFICULTY_TONE[exercise.difficulty]} size="xs">
            {difficultyLabel(exercise.difficulty)}
          </Pill>
        </View>

        {exercise.description ? (
          <Text
            fontFamily="$body"
            fontSize={12}
            lineHeight={17}
            color="$text3"
            numberOfLines={2}
            marginTop={6}
          >
            {exercise.description}
          </Text>
        ) : null}

        {hasTags ? (
          <View flexDirection="row" gap={6} marginTop={8} flexWrap="wrap">
            {/* Muscle + equipment tags stay neutral/subtle — the difficulty
                pill is the card's single colour accent (mirrors the subtle
                single-accent treatment on the Workouts rows). */}
            {muscle ? (
              <Pill tone="neutral" size="xs">
                {muscle}
              </Pill>
            ) : null}
            {equipment.map((e) => (
              <Pill key={e} tone="neutral" size="xs">
                {e}
              </Pill>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export const ExerciseCard = memo(ExerciseCardBase);
