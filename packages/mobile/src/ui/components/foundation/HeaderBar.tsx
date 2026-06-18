import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";

/**
 * <HeaderBar> — top-of-screen header.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:180-200.
 * Implements 01-design-system/design.md § Foundation primitives #11.
 *
 * Compact (default): centred 18pt title with leading/trailing slots.
 * Large: left-aligned eyebrow + 32pt display title + optional sub.
 */

export type HeaderBarProps = {
  /** String, or rich inline content (e.g. a greeting with a colored name).
   *  Rendered inside the header's styled <Text>, so nested <Text> inherits the
   *  title typography and can override just the color. */
  title?: ReactNode;
  eyebrow?: string;
  sub?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  large?: boolean;
  testID?: string;
};

export function HeaderBar({
  title,
  eyebrow,
  sub,
  leading,
  trailing,
  large = false,
  testID,
}: HeaderBarProps) {
  return (
    <View
      testID={testID}
      paddingHorizontal={20}
      paddingTop={8}
      paddingBottom={large ? 20 : 12}
      gap={large ? 12 : 6}
    >
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        minHeight={36}
      >
        <View flexDirection="row" alignItems="center" gap={10}>
          {leading}
        </View>

        {!large && title ? (
          <View
            position="absolute"
            left={0}
            right={0}
            alignItems="center"
            pointerEvents="none"
          >
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={18}
              letterSpacing={-0.4}
              color="$text"
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>
        ) : null}

        <View flexDirection="row" alignItems="center" gap={6}>
          {trailing}
        </View>
      </View>

      {large ? (
        <View>
          {eyebrow ? (
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$text3"
              marginBottom={4}
            >
              {eyebrow}
            </Text>
          ) : null}
          {title ? (
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={32}
              letterSpacing={-1}
              color="$text"
            >
              {title}
            </Text>
          ) : null}
          {sub ? (
            <Text fontFamily="$body" fontSize={13} color="$text2" marginTop={4}>
              {sub}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
