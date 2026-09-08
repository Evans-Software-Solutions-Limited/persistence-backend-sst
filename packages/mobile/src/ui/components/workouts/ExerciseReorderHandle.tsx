import { useCallback } from "react";
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
   * True when this grip can be dragged, i.e. the row is inside a
   * `ReorderableList`. It only changes what the hint says: the DRAG itself is
   * not wired here.
   *
   * `ReorderableList` puts an invisible Gesture Handler target over the row's
   * top-left corner, on top of this grip, because a target inside the row's
   * body would unmount when the body collapses to a compact row mid-gesture
   * and take the drag with it. So this component draws the grip and owns its
   * accessibility; the list owns the gesture.
   */
  draggable?: boolean;
};

/** The grip: what it looks like, what it says, and its Move actions. */
export function ExerciseReorderHandle({
  label,
  position,
  total,
  onMove,
  draggable = false,
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

  // A one-item list has nothing to move: both action filters below collapse to
  // empty, so advertising the actions in the hint promised VoiceOver users two
  // gestures that do nothing. Treat "can move" as the actions actually
  // existing, not merely as `onMove` being wired.
  const canMove = onMove != null && total > 1;

  // Nothing this grip can do: no drag, and no Move actions. Rendering it
  // anyway gave sighted users a drag affordance that does not drag and
  // VoiceOver an `adjustable` control whose adjust swipes are silent no-ops.
  if (!canMove && !draggable) return null;

  return (
    <View
      accessible
      testID={`reorder-${position}`}
      accessibilityRole="adjustable"
      accessibilityLabel={`Reorder ${label}, position ${position} of ${total}`}
      accessibilityHint={
        draggable
          ? canMove
            ? "Hold and drag to move, or use Move up and Move down actions"
            : "Hold and drag to move"
          : canMove
            ? "Use Move up and Move down actions"
            : undefined
      }
      accessibilityActions={[
        ...(canMove && position > 1
          ? [{ name: "decrement" as const, label: "Move up" }]
          : []),
        ...(canMove && position < total
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
}
