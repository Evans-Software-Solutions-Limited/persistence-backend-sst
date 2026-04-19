import { View } from "@tamagui/core";
import { Text } from "../../../src/ui/components";

/**
 * Placeholder for Phase 6 (Create exercise). Exists so Expo Router's typed
 * routes register `/(app)/exercises/create` for the list container's
 * onCreateExercise navigation. Replace with the real form in Phase 6.
 */
export default function CreateExerciseScreen() {
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
        Coming in Phase 6
      </Text>
    </View>
  );
}
