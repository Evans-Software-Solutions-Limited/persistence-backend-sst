import { Text, View } from "@tamagui/core";
import { router } from "expo-router";
import { useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { Btn, IconBtn, Segmented } from "@/ui/components/foundation";
import { IconPlus, IconSearch } from "@/ui/components/icons";
import { ExerciseListContainer } from "@/ui/containers/ExerciseListContainer";
import { WorkoutsListContainer } from "@/ui/containers/WorkoutsListContainer";

/**
 * <TrainHubContainer> — the Train tab hub.
 *
 * Spec: specs/14-navigation/design.md § <TrainHubContainer> — Segmented
 *       composition
 *       specs/14-navigation/requirements.md STORY-005 (AC 5.1, 5.3–5.6)
 *       specs/04-workout-management/requirements.md (revised 2026-06-01)
 *
 * Owns the hub CHROME — the eyebrow ("TRAIN"), the segment-driven title, the
 * contextual top-right action, and the <Segmented> switcher. The header is an
 * inline flex-end row matching ~/Downloads/handoff/design-source/
 * prototype-hubs.jsx:15–33 (`TrainHubScreen`) — eyebrow + 32pt title on the
 * left, the contextual action bottom-aligned on the right. (The shared
 * <HeaderBar large> is the iOS-large-title pattern — leading-on-top + title
 * below — which is wrong for a hub; the prototype hubs use their own header.)
 *
 * The list BODIES (WorkoutsListContainer / ExerciseListContainer) are owned by
 * `04-workout-management`.
 *
 * Transitional note: ExerciseListContainer still renders its own legacy
 * header + search; 04.2 reworks it into a headerless body. Until then there's
 * a benign chrome overlap on the Exercises segment. The Create action + the
 * /exercises/create deep-link's `pendingCreate` flag route to the existing
 * full-screen creator until 04.3 ships the bottom-sheet.
 */
export function TrainHubContainer() {
  const segment = useTrainSegment((s) => s.segment);
  const setSegment = useTrainSegment((s) => s.setSegment);
  const pendingCreate = useTrainSegment((s) => s.pendingCreate);
  const clearPendingCreate = useTrainSegment((s) => s.clearPendingCreate);
  // The hub applies the top safe-area inset itself so the header doesn't
  // overlap the status bar (battery/clock).
  const insets = useSafeAreaInsets();

  const openCreateExercise = () => {
    // TODO(04-workout-management § Sheet mount-point): replace the push with
    // a local <CreateExerciseSheetContainer> bottom-sheet once 04.3 ships it.
    router.push("/(app)/exercises/create");
  };

  // Legacy /exercises/create deep-links surface here via the redirect map
  // (Phase 14.7). The redirect sets `pendingCreate`; consume + clear it once
  // on mount so the creator opens exactly once.
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

  return (
    <View flex={1} paddingTop={insets.top} testID="train-hub">
      {/* Hub header — inline flex-end row (prototype-hubs.jsx:15–33). */}
      <View
        testID="train-header"
        paddingHorizontal={20}
        paddingTop={8}
        paddingBottom={12}
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
      >
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
            marginBottom={4}
          >
            TRAIN
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={32}
            letterSpacing={-0.96}
            color="$text"
          >
            {segment === "Workouts" ? "Workouts" : "Exercises"}
          </Text>
        </View>
        {segment === "Exercises" ? (
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
        )}
      </View>

      <View paddingHorizontal={16} paddingBottom={12}>
        <Segmented
          options={["Workouts", "Exercises"]}
          value={segment}
          onChange={(next) => {
            // Narrow rather than cast — if the option set ever drifts, an
            // unrecognised value is ignored instead of silently coercing.
            if (next === "Workouts" || next === "Exercises") {
              setSegment(next);
            }
          }}
          testID="train-segment"
        />
      </View>
      <View flex={1}>
        {segment === "Workouts" ? (
          <WorkoutsListContainer />
        ) : (
          <ExerciseListContainer />
        )}
      </View>
    </View>
  );
}
