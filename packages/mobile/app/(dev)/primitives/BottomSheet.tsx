import { View } from "@tamagui/core";
import { Stack } from "expo-router";
import { useState } from "react";

import {
  BottomSheet,
  type BottomSheetAccent,
} from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

const ACCENTS: BottomSheetAccent[] = ["primary", "gold", "trainer", "ember"];

/** /dev/primitives/BottomSheet — open default/peek sheets per accent (STORY-009). */
export default function BottomSheetDevRoute() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <Stack.Screen options={{ title: "BottomSheet" }} />
      <Screen scroll padded testID="dev-primitive-BottomSheet">
        <View paddingVertical="$lg" gap="$md">
          <Text variant="caption" muted>
            ACCENTS (default 78% height)
          </Text>
          {ACCENTS.map((accent) => (
            <Btn
              key={accent}
              variant="soft"
              tone={accent === "ember" ? "ember" : accent}
              onPress={() => setOpen(accent)}
            >
              {`Open ${accent}`}
            </Btn>
          ))}

          <Text variant="caption" muted>
            PEEK (60% height)
          </Text>
          <Btn variant="outline" tone="primary" onPress={() => setOpen("peek")}>
            Open peek
          </Btn>
        </View>

        {ACCENTS.map((accent) => (
          <BottomSheet
            key={accent}
            visible={open === accent}
            onClose={() => setOpen(null)}
            eyebrow="QUICK ADD"
            title={`${accent} sheet`}
            accent={accent}
          >
            <Text variant="body">
              Children scroll; the header stays fixed. Tap the backdrop or drag
              down to dismiss.
            </Text>
          </BottomSheet>
        ))}

        <BottomSheet
          visible={open === "peek"}
          onClose={() => setOpen(null)}
          title="Peek sheet"
          height="peek"
        >
          <Text variant="body">A 60% peek sheet.</Text>
        </BottomSheet>
      </Screen>
    </>
  );
}
