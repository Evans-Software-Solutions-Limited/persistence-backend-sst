import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";

import type { Workout } from "@/domain/models/workout";
import { SPLIT_BADGE, type WorkoutSplit } from "@/domain/services/workoutSplit";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import {
  NEUTRAL_HEX,
  type Tone,
  toneHex,
  toneTokens,
} from "@/ui/components/foundation/tones";
import {
  IconBook,
  IconChevronR,
  IconDumbbell,
  IconPlay,
} from "@/ui/components/icons";

/**
 * <WorkoutRow> — single workout row inside a <Card pad={0}> list.
 * Source: ~/Downloads/handoff/design-source/prototype-hubs.jsx:44–92
 * (`TrainWorkoutsContent`).
 *
 * Two variants:
 *  - "saved"    → 40×40 tile + 32pt Play IconBtn (starts the workout).
 *  - "template" → 40×40 Book tile + a trailing chevron (opens for preview/use).
 *
 * The tile colour + meta badge come from the derived `split` (see
 * `domain/services/workoutSplit`). `split = null` (e.g. exercise library not
 * cached yet) → neutral `primary` tile, no badge — no invented data.
 */

export type WorkoutRowVariant = "saved" | "template";

/** Pressable feedback — dim to 0.85 while pressed. Extracted so the
 * pressed/idle branch is unit-testable without simulating press state. */
export const rowPressStyle = ({ pressed }: { pressed: boolean }) => ({
  opacity: pressed ? 0.85 : 1,
});

/** Split → tile/badge tone. ember = lower-body & full (heavy/compound),
 * trainer = upper-mixed & core, success/error = conditioning. */
const SPLIT_TONE: Record<WorkoutSplit, Tone> = {
  push: "primary",
  pull: "gold",
  legs: "ember",
  lower: "ember",
  full: "ember",
  upper: "trainer",
  core: "trainer",
  mobility: "success",
  cardio: "error",
};

export type WorkoutRowProps = {
  workout: Workout;
  /** "saved" (default) = Dumbbell + Play; "template" = Book + chevron. */
  variant?: WorkoutRowVariant;
  /** Derived split — colours the tile + shows the meta badge. null = neutral. */
  split?: WorkoutSplit | null;
  /** Suppress the bottom hairline on the final row in a Card. */
  isLast: boolean;
  onPress: () => void;
  /** Start the workout — only used by the "saved" variant. */
  onStart?: () => void;
  /** Owner-only context menu (Edit / Delete). Omitted for non-owners. */
  onLongPress?: () => void;
};

export function WorkoutRow({
  workout,
  variant = "saved",
  split = null,
  isLast,
  onPress,
  onStart,
  onLongPress,
}: WorkoutRowProps) {
  const exerciseCount = workout.exercises.length;
  const meta = `${workout.estimatedDurationMinutes}m · ${exerciseCount} ${
    exerciseCount === 1 ? "exercise" : "exercises"
  }`;
  const isTemplate = variant === "template";
  const tone: Tone = split ? SPLIT_TONE[split] : "primary";
  const badge = split ? SPLIT_BADGE[split] : null;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={`workout-row-${workout.id}`}
      accessibilityRole="button"
      accessibilityLabel={workout.name}
      style={rowPressStyle}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={14}
        paddingHorizontal={14}
        borderBottomWidth={isLast ? 0 : 1}
        borderColor="$border"
      >
        <View
          width={40}
          height={40}
          borderRadius={10}
          backgroundColor={toneTokens(tone).dim}
          alignItems="center"
          justifyContent="center"
        >
          {isTemplate ? (
            <IconBook size={20} color={toneHex(tone).base} />
          ) : (
            <IconDumbbell size={20} color={toneHex(tone).base} />
          )}
        </View>
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={15}
            color="$text"
          >
            {workout.name}
          </Text>
          <Text fontFamily="$body" fontSize={11.5} color="$text3" marginTop={1}>
            {meta}
            {badge ? " · " : null}
            {badge ? (
              <Text color={toneTokens(tone).base} fontWeight="600">
                {badge}
              </Text>
            ) : null}
          </Text>
        </View>
        {isTemplate ? (
          <IconChevronR size={16} color={NEUTRAL_HEX.text3} />
        ) : (
          <IconBtn
            size={32}
            icon={<IconPlay size={12} />}
            tone="primary"
            onPress={onStart}
            accessibilityLabel={`Start ${workout.name}`}
          />
        )}
      </View>
    </Pressable>
  );
}
