import { View } from "@tamagui/core";
import { Text } from "../../../src/ui/components";
import { DevExerciseCreatorContainer } from "../../../src/ui/containers/DevExerciseCreatorContainer";

/**
 * M0 `__DEV__`-gated creator (AC 7.18).
 *
 * Dev builds: render the minimal creator form so the smoke test can
 * exercise `POST /exercises` end-to-end.
 * Production builds: fall back to the Phase 6 "coming in M5" placeholder
 * — the full-featured creator is scoped into M5 Exercise detail +
 * creator, not M0.
 *
 * `__DEV__` is a React Native global that Metro evaluates at bundle
 * time. In a production bundle the branch is dead-code-eliminated, so
 * the creator container never ships to end users.
 */
export default function CreateExerciseScreen() {
  if (__DEV__) {
    return <DevExerciseCreatorContainer />;
  }
  return (
    <View
      flex={1}
      backgroundColor="$background"
      justifyContent="center"
      alignItems="center"
      padding="$base"
    >
      <Text variant="h3" align="center">
        Create exercise
      </Text>
      <Text variant="body" secondary align="center" marginTop="$sm">
        Coming in M5
      </Text>
    </View>
  );
}
