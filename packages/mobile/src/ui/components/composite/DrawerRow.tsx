import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { Pressable } from "react-native";

import { IconChevronR, iconDefaults } from "../icons";
import { Skeleton } from "../Skeleton";

/**
 * <DrawerRow> — icon tile + title/sub stack + trailing slot + chevron.
 * Used by ProfileDrawer rows + ProfileScreen rows.
 * Source: extra.jsx:119.
 * Implements 01-design-system/design.md § Composite primitives #2 +
 * STORY-004 AC 4.6 (loading skeleton).
 */

export type DrawerRowProps = {
  icon: ReactNode;
  title: string;
  sub?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Swap title/sub for skeleton blocks (offline-first cache-loading state). */
  loading?: boolean;
  testID?: string;
  accessibilityLabel?: string;
};

export function DrawerRow({
  icon,
  title,
  sub,
  trailing,
  onPress,
  loading = false,
  testID,
  accessibilityLabel,
}: DrawerRowProps) {
  const body = (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      width="100%"
      backgroundColor="$surface2"
      borderColor="$border"
      borderWidth={1}
      borderRadius={12}
      paddingVertical={10}
      paddingHorizontal={12}
      minHeight={44}
    >
      <View
        width={32}
        height={32}
        borderRadius={8}
        backgroundColor="$surface3"
        alignItems="center"
        justifyContent="center"
      >
        {icon}
      </View>

      <View flex={1}>
        {loading ? (
          <View gap={6}>
            <Skeleton
              width={54}
              height={12}
              variant="text"
              testID={testID ? `${testID}-skeleton-title` : undefined}
            />
            <Skeleton width={80} height={10} variant="text" />
          </View>
        ) : (
          <>
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={20}
              letterSpacing={-0.3}
              color="$text"
              numberOfLines={1}
            >
              {title}
            </Text>
            {sub ? (
              <Text
                fontFamily="$body"
                fontSize={11}
                color="$text3"
                marginTop={1}
                numberOfLines={1}
              >
                {sub}
              </Text>
            ) : null}
          </>
        )}
      </View>

      {trailing}
      <IconChevronR {...iconDefaults({ size: 14 })} color="#8A8A98" />
    </View>
  );

  if (!onPress || loading) {
    return (
      <View testID={testID} accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      {body}
    </Pressable>
  );
}
