import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";

/**
 * <DrawerSection> — eyebrow-titled group of DrawerRows / cards inside the
 * ProfileDrawer (Account / Subscription / Preferences).
 *
 * Spec-local composite (08-profile-settings/design.md § <DrawerSection>) —
 * trivial enough to live here rather than in 01-design-system.
 * Source: extra.jsx:110–117.
 */

export type DrawerSectionProps = {
  title: string;
  children: ReactNode;
  testID?: string;
};

export function DrawerSection({ title, children, testID }: DrawerSectionProps) {
  return (
    <View marginBottom={14} testID={testID}>
      <Text
        fontFamily="$display"
        fontSize={10.5}
        fontWeight="600"
        letterSpacing={1.7}
        textTransform="uppercase"
        color="$text3"
        marginBottom={8}
        paddingLeft={4}
      >
        {title}
      </Text>
      <View gap={4}>{children}</View>
    </View>
  );
}
