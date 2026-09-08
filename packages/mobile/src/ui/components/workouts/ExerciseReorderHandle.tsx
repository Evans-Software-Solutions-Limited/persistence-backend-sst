import { useCallback, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
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
  /**
   * Idle-mode counterpart to `DragHandle`: holding the grip asks the screen to
   * enter reorder mode. Only one of the two is ever supplied — the rows have
   * to be a uniform height before the library can drag them at all, so the
   * hold that collapses the list and the hold that drags are necessarily
   * different gestures. Neither is a button, and the mode leaves on the drop.
   */
  onLongPressReorder?: () => void;
};

/** Gesture + accessibility control shared by the form and live rows. */
export function ExerciseReorderHandle({
  label,
  position,
  total,
  onMove,
  DragHandle,
  onLongPressReorder,
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

  const a11y = {
    testID: `reorder-${position}`,
    accessibilityRole: "adjustable" as const,
    accessibilityLabel: `Reorder ${label}, position ${position} of ${total}`,
    // Compact mode withholds `onMove`, so advertising those actions there left
    // VoiceOver's increment/decrement swipes as silent no-ops.
    accessibilityHint: DragHandle
      ? canMove
        ? "Hold and drag to move, or use Move up and Move down actions"
        : "Hold and drag to move"
      : onLongPressReorder
        ? canMove
          ? "Hold to reorder, or use Move up and Move down actions"
          : "Hold to reorder"
        : canMove
          ? "Use Move up and Move down actions"
          : undefined,
    accessibilityActions: [
      ...(canMove && position > 1
        ? [{ name: "decrement" as const, label: "Move up" }]
        : []),
      ...(canMove && position < total
        ? [{ name: "increment" as const, label: "Move down" }]
        : []),
    ],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "decrement") move(-1);
      if (event.nativeEvent.actionName === "increment") move(1);
    },
    style: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
  };

  // Nothing this grip can do: no drag (no `DragHandle`), no mode to enter (no
  // `onLongPressReorder`) and no Move actions (`canMove` false — a one-item
  // list). Rendering it anyway gave sighted users a drag affordance that does
  // not drag and VoiceOver an `adjustable` control whose adjust swipes are
  // silent no-ops. The callers still pass `onMove`, so this is the only place
  // that can tell.
  if (!canMove && !DragHandle && !onLongPressReorder) return null;

  // While DRAGGING the grip must be a plain View: `SortableItem.Handle` wraps
  // it in a GestureDetector, and RN's press responder claims the touch before
  // Gesture Handler's pan can activate, so a Pressable simply never drags.
  if (DragHandle) {
    return (
      <DragHandle>
        {/*
          `accessible` is required: a View carrying accessibilityRole/actions
          without it is not an accessibility element on iOS, so VoiceOver
          could not focus the grip and the Move up / Move down actions were
          unreachable in drag mode. It was a Pressable before (accessible by
          default) and lost that when it had to stop being one.
        */}
        <View accessible {...a11y}>
          <IconGrip size={20} color={color.$text3} />
        </View>
      </DragHandle>
    );
  }

  // Idle: a Pressable is exactly right, since the hold only has to ask the
  // screen to collapse into uniform rows.
  return (
    <Pressable
      {...a11y}
      onLongPress={() => {
        if (!onLongPressReorder) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPressReorder();
      }}
      delayLongPress={180}
    >
      <IconGrip size={20} color={color.$text3} />
    </Pressable>
  );
}
