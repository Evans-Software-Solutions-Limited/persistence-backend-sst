import { View } from "@tamagui/core";
import { Pressable } from "react-native";

import { toneTokens } from "../foundation/tones";
import { IconCheck, iconDefaults } from "../icons";

/**
 * <HabitTile> — 36x36 daily-check cell.
 * Used by Home HabitsGrid + Progress habits surface.
 * Source: home.jsx:227 (within HabitsGrid).
 * Implements 01-design-system/design.md § Composite primitives #9.
 *
 * The 44pt touch target is achieved by the parent grid row padding when
 * interactive (per design.md note); the cell itself is 36x36.
 */

export type HabitState = "done" | "today" | "missed" | "locked";
export type HabitTone = "primary" | "gold" | "trainer" | "ember" | "success";

export type HabitTileProps = {
  state: HabitState;
  tone: HabitTone;
  label?: string;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
};

const SIZE = 36;

export function habitTilePressStyle({ pressed }: { pressed: boolean }) {
  return { opacity: pressed ? 0.7 : 1 };
}

export function HabitTile({
  state,
  tone,
  label,
  onPress,
  testID,
  accessibilityLabel,
}: HabitTileProps) {
  const t = toneTokens(tone);

  // Per-state visual contract.
  const isDone = state === "done";
  const isToday = state === "today";
  const isLocked = state === "locked";

  const backgroundColor = isDone ? t.base : isToday ? t.dim : "$surface3";
  const borderColor = isToday ? t.base : isLocked ? "$text4" : "transparent";
  const borderWidth = isToday || isLocked ? 1 : 0;
  const borderStyle = isToday ? "dashed" : "solid";

  // Locked tiles are never interactive regardless of onPress.
  const interactive = Boolean(onPress) && !isLocked;

  const cell = (
    <View
      width={SIZE}
      height={SIZE}
      borderRadius={10}
      alignItems="center"
      justifyContent="center"
      backgroundColor={backgroundColor}
      borderColor={borderColor}
      borderWidth={borderWidth}
      style={{ borderStyle }}
    >
      {isDone ? (
        <IconCheck
          {...iconDefaults({ size: 14, active: true })}
          color={resolveInk(tone)}
        />
      ) : null}
    </View>
  );

  const a11yLabel = accessibilityLabel ?? `${label ?? "Habit"}: ${state}`;

  if (!interactive) {
    return (
      <View
        testID={testID}
        accessibilityLabel={a11yLabel}
        accessibilityState={{ disabled: isLocked }}
      >
        {cell}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected: isDone }}
      // 36x36 cell + 4pt slop on each edge = 44pt effective touch target.
      hitSlop={4}
      style={habitTilePressStyle}
    >
      {cell}
    </Pressable>
  );
}

// Concrete ink colour for the check glyph on a solid tone fill.
function resolveInk(tone: HabitTone): string {
  switch (tone) {
    case "primary":
      return "#042F39";
    case "gold":
      return "#2A1F00";
    case "trainer":
      return "#1E1B4B";
    case "ember":
    case "success":
      return "#0A0B12";
  }
}
