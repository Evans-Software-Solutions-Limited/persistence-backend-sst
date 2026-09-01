import { useCallback } from "react";
import { AccessibilityInfo, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { IconGrip } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

export type ExerciseReorderHandleProps = {
  label: string;
  position: number;
  total: number;
  onMove: (direction: -1 | 1) => void;
  onDrag?: () => void;
  isDragging?: boolean;
};

/** OTA-safe gesture + accessibility control shared by form and live rows. */
export function ExerciseReorderHandle({
  label,
  position,
  total,
  onMove,
  onDrag,
  isDragging = false,
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
  return (
    <Pressable
      testID={`reorder-${position}`}
      accessibilityRole="adjustable"
      accessibilityLabel={`Reorder ${label}, position ${position} of ${total}`}
      accessibilityHint="Long press and drag, or use Move up and Move down actions"
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
      onLongPress={() => {
        if (!onDrag || isDragging) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onDrag();
      }}
      delayLongPress={180}
      disabled={isDragging}
      style={{
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: isDragging ? 0.7 : 1,
      }}
    >
      <IconGrip size={20} color={color.$text3} />
    </Pressable>
  );
}
