import { View } from "@tamagui/core";
import { PLogoDrawLoader } from "../src/ui/components";
import { color } from "../src/ui/theme/tokens";

export default function Index() {
  // Auth-based navigation is handled by AuthGate in _layout.tsx.
  // This screen only shows briefly while the session is resolved.
  return (
    <View
      flex={1}
      justifyContent="center"
      alignItems="center"
      backgroundColor={color.$bg}
      testID="root-bootstrap-loading"
    >
      <PLogoDrawLoader />
    </View>
  );
}
