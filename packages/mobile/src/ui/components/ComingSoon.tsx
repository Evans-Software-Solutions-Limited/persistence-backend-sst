import { Ionicons } from "@expo/vector-icons";
import { View } from "@tamagui/core";
import type { ComponentProps } from "react";

import { Column } from "./Column";
import { Text } from "./Text";

type ComingSoonProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  testID?: string;
};

/**
 * Placeholder screen for tabs whose real UI lands in later phases.
 * Kept deliberately minimal so it reads as "intentional blank", not "broken".
 */
export function ComingSoon({
  icon,
  title,
  description,
  testID,
}: ComingSoonProps) {
  return (
    <View
      flex={1}
      backgroundColor="$background"
      justifyContent="center"
      alignItems="center"
      padding="$2xl"
      testID={testID}
    >
      <Column gap="base" centered>
        <View
          width={72}
          height={72}
          borderRadius="$full"
          backgroundColor="$surfaceSecondary"
          justifyContent="center"
          alignItems="center"
        >
          <Ionicons name={icon} size={32} color="#00D4FF" />
        </View>
        <Text variant="h3" align="center">
          {title}
        </Text>
        <Text variant="body" secondary align="center">
          {description}
        </Text>
      </Column>
    </View>
  );
}
