import { Ionicons } from "@expo/vector-icons";
import { View } from "@tamagui/core";
import type { ComponentProps } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Column } from "./Column";
import { Text } from "./Text";

type ComingSoonProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  /**
   * Apply the top safe-area inset. Opt-in because it's only correct when
   * ComingSoon IS the screen and there's no chrome above it (tab screens,
   * header-less stack screens). Routes under the native header (coming-soon,
   * fuel/recipes) or embedded mid-scroll (ProfilePresenter) must leave this
   * off — the inset is already consumed above them.
   */
  safeAreaTop?: boolean;
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
  safeAreaTop = false,
  testID,
}: ComingSoonProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$background"
      justifyContent="center"
      alignItems="center"
      padding="$2xl"
      paddingTop={safeAreaTop ? insets.top : undefined}
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
