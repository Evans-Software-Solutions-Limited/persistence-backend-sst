import { useCallback, useMemo } from "react";
import { AccessibilityInfo, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { IconGrip } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

export type ExerciseReorderHandleProps = {
  label: string;
  position: number;
  total: number;
  onMove: (direction: -1 | 1) => void;
};

/** OTA-safe gesture + accessibility control shared by form and live rows. */
export function ExerciseReorderHandle({
  label,
  position,
  total,
  onMove,
}: ExerciseReorderHandleProps) {
  const move = useCallback(
    (direction: -1 | 1) => {
      const next = position + direction;
      if (next < 1 || next > total) return;
      onMove(direction);
      void Haptics.selectionAsync();
      void AccessibilityInfo.announceForAccessibility(
        `${label} moved to position ${next} of ${total}`,
      );
    },
    [label, onMove, position, total],
  );
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(180)
        .onEnd((event) => {
          if (Math.abs(event.translationY) < 28) return;
          runOnJS(move)(event.translationY < 0 ? -1 : 1);
        }),
    [move],
  );
  return (
    <GestureDetector gesture={pan}>
      <Pressable
        testID={`reorder-${position}`}
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${label}, position ${position} of ${total}`}
        accessibilityHint="Drag up or down, or use accessibility actions"
        accessibilityActions={[
          ...(position > 1
            ? [{ name: "decrement" as const, label: "Move up" }]
            : []),
          ...(position < total
            ? [{ name: "increment" as const, label: "Move down" }]
            : []),
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "decrement") move(-1);
          if (event.nativeEvent.actionName === "increment") move(1);
        }}
        style={{
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconGrip size={20} color={color.$text3} />
      </Pressable>
    </GestureDetector>
  );
}
