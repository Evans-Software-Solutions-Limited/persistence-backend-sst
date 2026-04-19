import { useLocalSearchParams } from "expo-router";
import { View } from "@tamagui/core";
import { Text } from "../../../src/ui/components";

/**
 * Placeholder for Phase 5 (Exercise detail). Kept trivial so Expo Router's
 * typed route generator registers `/(app)/exercises/[id]` — without this the
 * list container's navigation would fail type-check.
 */
export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View
      flex={1}
      backgroundColor="$background"
      justifyContent="center"
      alignItems="center"
      padding="$base"
    >
      <Text variant="h3" align="center">
        Exercise detail
      </Text>
      <Text variant="body" secondary align="center" marginTop="$sm">
        {id ? `ID: ${id}` : "Coming in Phase 5"}
      </Text>
    </View>
  );
}
