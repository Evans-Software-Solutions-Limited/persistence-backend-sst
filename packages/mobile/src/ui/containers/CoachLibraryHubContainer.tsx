import { Text, View } from "@tamagui/core";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useCoachLibrarySegment,
  type CoachLibrarySegment,
} from "@/ui/hooks/useCoachLibrarySegment";
import { Btn, Segmented } from "@/ui/components/foundation";
import { IconPlus } from "@/ui/components/icons";
import { ProgramsListContainer } from "@/ui/containers/ProgramsListContainer";
import { CoachWorkoutLibraryContainer } from "@/ui/containers/CoachWorkoutLibraryContainer";
import { ExerciseListContainer } from "@/ui/containers/ExerciseListContainer";

/**
 * <CoachLibraryHubContainer> — the coach Programs-tab hub.
 *
 * Spec: specs/24-coach-authoring/design.md § B.1
 *       specs/24-coach-authoring/requirements.md STORY-001 (AC 1.1–1.7),
 *       STORY-002 (AC 2.1, 2.2)
 *
 * Modelled directly on `<TrainHubContainer>` (the athlete Train hub):
 * owns the hub CHROME — top safe-area inset, eyebrow ("LIBRARY"), a
 * segment-driven 32pt title, a segment-aware top-right contextual "create"
 * action, and the `<Segmented>` switcher — and renders the body for the
 * active segment. This is net-new IA (no prototype screen); the *bodies*
 * (ProgramsListContainer / CoachWorkoutLibraryContainer `embedded` /
 * ExerciseListContainer) are unchanged elsewhere — only their outer chrome
 * moves here (NFR-3).
 *
 * Coach-only: the Programs tab is already `href: null` in athlete mode
 * (`(tabs)/_layout.tsx`), and each body already self-bounces a non-coach
 * (`CoachWorkoutLibraryContainer`) or is mode-agnostic
 * (`ProgramsListContainer`, `ExerciseListContainer`) — the hub adds no new
 * gate (AC 1.7).
 */

const CONTEXTUAL_ACTION: Record<
  CoachLibrarySegment,
  { label: string; route: string }
> = {
  Programmes: { label: "New programme", route: "/(app)/programs/create" },
  Workouts: {
    label: "Create workout",
    route: "/(app)/workouts/create?ctx=coach",
  },
  Exercises: { label: "Create", route: "/(app)/exercises/create" },
};

export function CoachLibraryHubContainer() {
  const segment = useCoachLibrarySegment((s) => s.segment);
  const setSegment = useCoachLibrarySegment((s) => s.setSegment);
  // The hub applies the top safe-area inset itself so the header doesn't
  // overlap the status bar (mirrors TrainHubContainer).
  const insets = useSafeAreaInsets();

  const action = CONTEXTUAL_ACTION[segment];
  const onPressAction = () => {
    // `router.push` typed routes don't cover the query-string variant used
    // by the Workouts action — cast, matching CoachWorkoutLibraryContainer's
    // own `onCreate`.
    router.push(action.route as never);
  };

  return (
    <View flex={1} paddingTop={insets.top} testID="coach-library-hub">
      <View
        testID="coach-library-header"
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
            LIBRARY
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={32}
            letterSpacing={-0.96}
            color="$text"
          >
            {segment}
          </Text>
        </View>
        <Btn
          variant="soft"
          tone="trainer"
          size="sm"
          icon={<IconPlus size={14} />}
          onPress={onPressAction}
          testID="coach-library-action"
        >
          {action.label}
        </Btn>
      </View>

      <View paddingHorizontal={16} paddingBottom={12}>
        <Segmented
          options={["Programmes", "Workouts", "Exercises"]}
          value={segment}
          onChange={(next) => {
            // Narrow rather than cast — if the option set ever drifts, an
            // unrecognised value is ignored instead of silently coercing.
            if (
              next === "Programmes" ||
              next === "Workouts" ||
              next === "Exercises"
            ) {
              setSegment(next);
            }
          }}
          accent="trainer"
          testID="coach-library-segment"
        />
      </View>
      <View flex={1}>
        {segment === "Programmes" ? (
          <ProgramsListContainer />
        ) : segment === "Workouts" ? (
          <CoachWorkoutLibraryContainer embedded />
        ) : (
          <ExerciseListContainer />
        )}
      </View>
    </View>
  );
}
