import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";

/**
 * <Section> — semantic screen section wrapper (eyebrow + title + action +
 * optional divider + body). Consolidates Home's `Section` + Progress's
 * `SectionTitle` + ui.jsx `SectionHeader`.
 * Source: home.jsx:155 + progress.jsx:61 + ui.jsx:144.
 * Implements 01-design-system/design.md § Composite primitives #1 +
 * STORY-004 AC 4.5.
 */

export type SectionProps = {
  eyebrow?: string;
  title?: string;
  /** Right-aligned action node (e.g. an IconBtn or "See all" Btn). */
  action?: ReactNode;
  /** Suppress the 1pt divider before the body. */
  hideHr?: boolean;
  children?: ReactNode;
  testID?: string;
};

export function Section({
  eyebrow,
  title,
  action,
  hideHr = false,
  children,
  testID,
}: SectionProps) {
  const hasHeader = Boolean(eyebrow || title || action);

  return (
    <View testID={testID} gap={12}>
      {hasHeader ? (
        <View
          flexDirection="row"
          alignItems="flex-end"
          justifyContent="space-between"
          paddingHorizontal={4}
        >
          <View flex={1}>
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
                fontWeight="700"
                fontSize={24}
                letterSpacing={-0.5}
                color="$text"
              >
                {title}
              </Text>
            ) : null}
          </View>
          {action ? <View>{action}</View> : null}
        </View>
      ) : null}

      {!hideHr && hasHeader && children != null ? (
        <View height={1} backgroundColor="$border" />
      ) : null}

      {children != null ? <View>{children}</View> : null}
    </View>
  );
}
