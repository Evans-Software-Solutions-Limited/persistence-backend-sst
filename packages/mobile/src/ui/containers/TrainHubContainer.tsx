import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { Btn, HeaderBar, IconBtn, Segmented } from "@/ui/components/foundation";
import { IconPlus, IconSearch } from "@/ui/components/icons";
import { ExerciseListContainer } from "@/ui/containers/ExerciseListContainer";
import { WorkoutsListContainer } from "@/ui/containers/WorkoutsListContainer";

/**
 * <TrainHubContainer> — the Train tab hub.
 *
 * Spec: specs/14-navigation/design.md § <TrainHubContainer> — Segmented
 *       composition
 *       specs/14-navigation/requirements.md STORY-005 (AC 5.1, 5.3–5.6)
 *
 * Owns the hub CHROME — the eyebrow ("TRAIN"), the segment-driven title,
 * the contextual top-right action, and the <Segmented> switcher. The list
 * BODIES (WorkoutsListContainer / ExerciseListContainer) are owned by
 * `04-workout-management`; this container only composes them under the hub
 * via the persisted segment slice (`useTrainSegment`).
 *
 * Transitional notes (resolved by 04-workout-management):
 *  - The list containers below still render their own legacy headers +
 *    search. 04 reworks them into headerless list bodies that consume the
 *    hub's contextual-action handlers (AC 5.4). Until that lands there's a
 *    benign chrome overlap; the IA + switcher this spec owns are correct.
 *  - design.md composes a <CreateExerciseSheetContainer> bottom-sheet
 *    (04 § Sheet mount-point, not yet shipped — it deletes the full-screen
 *    (app)/exercises/create route). Until 04 ships the sheet, the Create
 *    action + the /exercises/create deep-link's `pendingCreate` flag route
 *    to the existing full-screen creator so the flow stays functional.
 */
export function TrainHubContainer() {
  const segment = useTrainSegment((s) => s.segment);
  const setSegment = useTrainSegment((s) => s.setSegment);
  const pendingCreate = useTrainSegment((s) => s.pendingCreate);
  const clearPendingCreate = useTrainSegment((s) => s.clearPendingCreate);

  const openCreateExercise = () => {
    // TODO(04-workout-management § Sheet mount-point): replace the push with
    // a local <CreateExerciseSheetContainer> bottom-sheet once 04 ships it.
    router.push("/(app)/exercises/create");
  };

  // Legacy /exercises/create deep-links surface here via the redirect map
  // (Phase 14.7). The redirect sets `pendingCreate`; consume + clear it once
  // on mount so the creator opens exactly once. Keyed only on the flag so it
  // fires once per redirect; openCreateExercise is a stable navigation call.
  useEffect(() => {
    if (pendingCreate) {
      clearPendingCreate();
      openCreateExercise();
    }
  }, [pendingCreate, clearPendingCreate]);

  const openSearch = () => {
    // TODO(04-workout-management § STORY-007): open the Exercises search
    // sheet. Placeholder handler — the owning content wires the real one.
  };

  // NOTE: <View> from react-native, not <Stack> from expo-router — Stack is
  // a navigator (renders only <Stack.Screen> children) and would discard the
  // hub body.
  return (
    <View style={{ flex: 1 }} testID="train-hub">
      <HeaderBar
        large
        eyebrow="TRAIN"
        title={segment === "Workouts" ? "Workouts" : "Exercises"}
        testID="train-header"
        trailing={
          segment === "Exercises" ? (
            <Btn
              variant="soft"
              tone="primary"
              size="sm"
              icon={<IconPlus size={14} />}
              onPress={openCreateExercise}
            >
              Create
            </Btn>
          ) : (
            <IconBtn
              icon={<IconSearch size={18} />}
              tone="ghost"
              onPress={openSearch}
              accessibilityLabel="Search workouts"
            />
          )
        }
      />
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <Segmented
          options={["Workouts", "Exercises"]}
          value={segment}
          onChange={(next) => setSegment(next as "Workouts" | "Exercises")}
          testID="train-segment"
        />
      </View>
      <View style={{ flex: 1 }}>
        {segment === "Workouts" ? (
          <WorkoutsListContainer />
        ) : (
          <ExerciseListContainer />
        )}
      </View>
    </View>
  );
}
