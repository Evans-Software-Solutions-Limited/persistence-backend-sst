import { useCallback, type ReactNode } from "react";
import { AccessibilityInfo, View } from "react-native";
import * as Haptics from "expo-haptics";
import { IconGrip } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

export type ExerciseReorderHandleProps = {
  label: string;
  position: number;
  total: number;
  onMove?: (direction: -1 | 1) => void;
  /**
   * Wrapper supplied by `ReorderableList`'s `renderItem` that turns this grip
   * into the drag handle. Omit it and the grip is accessibility-only (Move
   * up / Move down), which is what the coach surfaces want.
   *
   * The gesture itself is NOT ours any more. It used to be an `onLongPress`
   * that called back to the screen, which then flipped a "reorder mode" — two
   * gestures to move one row, and no way out if the second was cancelled. The
   * library's own pan is `activateAfterLongPress(200)`, so holding the grip
   * drags it directly while a plain swipe still scrolls the list.
   */
  DragHandle?: (props: { children: ReactNode }) => ReactNode;
};

/** Gesture + accessibility control shared by the form and live rows. */
export function ExerciseReorderHandle({
  label,
  position,
  total,
  onMove,
  DragHandle,
}: ExerciseReorderHandleProps) {
  const move = useCallback(
    (direction: -1 | 1) => {
      const next = position + direction;
      if (!onMove || next < 1 || next > total) return;
      onMove(direction);
      void Haptics.selectionAsync();
      void AccessibilityInfo.announceForAccessibility(
        `${label} moved to position ${next} of ${total}`,
      );
    },
    [label, onMove, position, total],
  );

  // A View, NOT a Pressable. `SortableItem.Handle` wraps this in a
  // GestureDetector, and RN's press responder claims the touch before Gesture
  // Handler's pan can activate — so a Pressable grip simply never drags. The
  // accessibility contract does not need one: role, actions and hint all work
  // on a plain View, and nothing here handles onPress any more.
  const grip = (
    <View
      accessible
      testID={`reorder-${position}`}
      accessibilityRole="adjustable"
      accessibilityLabel={`Reorder ${label}, position ${position} of ${total}`}
      accessibilityHint={
        DragHandle
          ? "Hold and drag to move, or use Move up and Move down actions"
          : "Use Move up and Move down actions"
      }
      accessibilityActions={[
        ...(onMove && position > 1
          ? [{ name: "decrement" as const, label: "Move up" }]
          : []),
        ...(onMove && position < total
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
    </View>
  );

  return DragHandle ? <DragHandle>{grip}</DragHandle> : grip;
}
