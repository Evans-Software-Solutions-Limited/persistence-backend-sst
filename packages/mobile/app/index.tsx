import { View } from "@tamagui/core";
import { LoadingSpinner } from "../src/ui/components";

export default function Index() {
  // Auth-based navigation is handled by AuthGate in _layout.tsx.
  // This screen only shows briefly while the session is resolved.
  return (
    <View
      flex={1}
      justifyContent="center"
      alignItems="center"
      backgroundColor="$background"
    >
      <LoadingSpinner size="lg" />
    </View>
  );
}
