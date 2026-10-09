import type { ReactNode } from "react";
import { View, Text } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";

/** Fixed camera bounds prevent native preview collapse inside a sheet. */
export function TogetherScannerPresenter({
  camera,
  onCancel,
}: {
  camera: ReactNode;
  onCancel(): void;
}) {
  return (
    <View gap={12}>
      <Text color="$text2" fontFamily="$body">
        Point your camera at a Persistence invitation QR.
      </Text>
      <View
        height={240}
        width="100%"
        overflow="hidden"
        borderRadius={16}
        backgroundColor="$surface2"
      >
        {camera}
      </View>
      <Btn full variant="ghost" onPress={onCancel}>
        Cancel scanning
      </Btn>
    </View>
  );
}
