import { Text, View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable } from "react-native";

import { toneTokens } from "./tones";

/**
 * <Avatar> — circular initials avatar with optional status dot + COACH badge.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:205-234.
 * Implements 01-design-system/design.md § Foundation primitives #5 +
 * STORY-003 (AC 3.4) + STORY-005 (AC 5.4).
 *
 * No `onPress` → renders as a <View> (nest-safe inside a row Pressable, e.g.
 * the Home header avatar that opens the ProfileDrawer sits inside a row).
 */

export type AvatarTone = "primary" | "gold" | "trainer";
export type AvatarDot = "success" | "warning" | "error";

export type AvatarProps = {
  initials: string;
  /** Diameter. Default 36. */
  size?: number;
  tone?: AvatarTone;
  /** Status dot, top-right. */
  dot?: AvatarDot;
  /** Badge label (e.g. 'COACH'), bottom-right. Always rendered in $accentTrainer. */
  badge?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

// Concrete gradient colours per tone (LinearGradient needs real colours, not
// tokens). 135deg from base -> depth, matching the prototype.
const GRADIENT: Record<AvatarTone, [string, string]> = {
  primary: ["#22D3EE", "#0E7490"],
  gold: ["#F5C518", "#B45309"],
  trainer: ["#A78BFA", "#6D28D9"],
};

const DOT_COLOR: Record<AvatarDot, string> = {
  success: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",
};

export function Avatar({
  initials,
  size = 36,
  tone = "primary",
  dot,
  badge,
  onPress,
  accessibilityLabel,
  testID,
}: AvatarProps) {
  const inkToken = toneTokens(tone).ink;
  const [from, to] = GRADIENT[tone];
  const label = accessibilityLabel ?? `Avatar ${initials}`;

  const inner = (
    <View
      width={size}
      height={size}
      borderRadius={9999}
      position="relative"
      style={{ flexShrink: 0 }}
    >
      <LinearGradient
        colors={[from, to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: size,
          height: size,
          borderRadius: 9999,
          alignItems: "center",
          justifyContent: "center",
          // two-ring border: bg ring + border2 ring
          borderWidth: 1.5,
          borderColor: "rgba(255,255,255,0.10)",
        }}
      >
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={Math.round(size * 0.36)}
          letterSpacing={-0.3}
          color={inkToken}
        >
          {initials}
        </Text>
      </LinearGradient>

      {dot ? (
        <View
          testID={testID ? `${testID}-dot` : undefined}
          position="absolute"
          top={-1}
          right={-1}
          width={Math.max(8, size * 0.28)}
          height={Math.max(8, size * 0.28)}
          borderRadius={9999}
          backgroundColor={DOT_COLOR[dot]}
          borderWidth={2}
          borderColor="$bg"
        />
      ) : null}

      {badge ? (
        <View
          testID={testID ? `${testID}-badge` : undefined}
          position="absolute"
          right={-6}
          bottom={-4}
          backgroundColor="$accentTrainer"
          borderRadius={4}
          paddingVertical={2}
          paddingHorizontal={5}
          borderWidth={2}
          borderColor="$bg"
        >
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={8.5}
            letterSpacing={0.85}
            color="$bg"
          >
            {badge}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        accessibilityRole="image"
        accessibilityLabel={label}
      >
        {inner}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Expand the effective touch target to the 44pt floor when the avatar is
      // smaller (default 36) — keeps the visual size, meets Apple HIG.
      hitSlop={Math.max(0, Math.ceil((44 - size) / 2))}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      {inner}
    </Pressable>
  );
}
