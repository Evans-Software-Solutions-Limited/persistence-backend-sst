import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "@tamagui/core";

import { useTrainSegment } from "../../../src/ui/hooks/useTrainSegment";

/**
 * `/exercises/create` — deep-link redirect stub.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-006 AC 6.6
 *
 * The full-screen exercise creator is gone — exercise creation is now the
 * <CreateExerciseSheetContainer> bottom-sheet inside the Train hub (04.3).
 * This route survives only as the redirect target for legacy
 * `/exercises/create` deep links: it switches the Train hub to the Exercises
 * segment, raises the `pendingCreate` flag (the hub's open-sheet signal), and
 * replaces itself with the Train tab so the sheet opens over the hub.
 *
 * Revised 2026-06-02 (Phase 04.3): kept as a redirect stub rather than
 * hard-deleted. AC 6.6 calls for deleting the route + a redirect in
 * 14-navigation's deep-link map, but that map (Phase 14.7 `LegacyRedirects`)
 * is deferred and unbuilt, so a hard delete would 404 the deep link. The stub
 * is the self-contained redirect home until 14.7 lands; the full-screen
 * creator (the old `__DEV__` `DevExerciseCreatorContainer`) is removed.
 */
export default function CreateExerciseRedirect() {
  useEffect(() => {
    const train = useTrainSegment.getState();
    train.setSegment("Exercises");
    train.setPendingCreate(true);
    router.replace("/(app)/(tabs)/train");
  }, []);

  return <View flex={1} backgroundColor="$background" />;
}
