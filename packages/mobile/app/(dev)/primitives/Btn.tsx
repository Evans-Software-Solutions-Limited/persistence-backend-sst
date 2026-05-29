import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import {
  Btn,
  type BtnSize,
  type BtnTone,
  type BtnVariant,
} from "@/ui/components/foundation/Btn";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/**
 * /dev/primitives/Btn — 4 variants × 6 tones × 3 sizes = 72 buttons
 * (01-design-system STORY-009 AC 9.2 / design.md § Smoke-test routes).
 */
const VARIANTS: BtnVariant[] = ["filled", "outline", "ghost", "soft"];
const TONES: BtnTone[] = [
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
];
const SIZES: BtnSize[] = ["sm", "md", "lg"];

export default function BtnDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Btn" }} />
      <Screen scroll padded testID="dev-primitive-Btn">
        <View paddingVertical="$lg" gap="$xl">
          {VARIANTS.map((variant) => (
            <View key={variant} gap="$sm">
              <Text variant="caption" muted>
                {variant.toUpperCase()}
              </Text>
              {TONES.map((tone) => (
                <View
                  key={tone}
                  flexDirection="row"
                  gap="$sm"
                  alignItems="center"
                >
                  {SIZES.map((size) => (
                    <Btn
                      key={size}
                      variant={variant}
                      tone={tone}
                      size={size}
                      onPress={() => undefined}
                    >
                      {tone}
                    </Btn>
                  ))}
                </View>
              ))}
            </View>
          ))}

          <Text variant="caption" muted>
            FULL + DISABLED
          </Text>
          <Btn onPress={() => undefined} full>
            Full width
          </Btn>
          <Btn onPress={() => undefined} disabled>
            Disabled
          </Btn>
        </View>
      </Screen>
    </>
  );
}
