import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { color } from "@/ui/theme/tokens";

/** Me is primary; partners take the info, success and gold rings in seat order (PER-60). */
export type TogetherAvatarTone = "primary" | "info" | "success" | "gold";
export const TOGETHER_PARTNER_TONES: readonly TogetherAvatarTone[] = [
  "info",
  "success",
  "gold",
];
const RING: Record<TogetherAvatarTone, string> = {
  primary: color.$primary,
  info: color.$info,
  success: color.$success,
  gold: color.$gold,
};

export function togetherInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Reviewed Together initials: the selection ring sits outside the face. */
export function TogetherAthleteAvatar(p: {
  name: string;
  size?: number;
  selected?: boolean;
  tone?: TogetherAvatarTone;
  onPress?(): void;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "tab";
}) {
  const size = p.size ?? 26;
  const ring = RING[p.tone ?? "primary"];
  const face = (
    <View
      width={size}
      height={size}
      borderRadius={999}
      flexShrink={0}
      borderWidth={1.5}
      style={{ borderColor: ring }}
      backgroundColor="$surface"
      alignItems="center"
      justifyContent="center"
      testID="together-athlete-avatar"
    >
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={size * 0.42}
        style={{ color: ring }}
      >
        {togetherInitials(p.name)}
      </Text>
    </View>
  );
  const ringed = p.selected ? (
    <View
      borderRadius={999}
      padding={2}
      backgroundColor="$surface"
      borderWidth={1.5}
      style={{ borderColor: ring, margin: -3.5 }}
    >
      {face}
    </View>
  ) : (
    face
  );
  return p.onPress ? (
    <Pressable
      onPress={p.onPress}
      accessibilityRole={p.accessibilityRole ?? "button"}
      accessibilityLabel={p.accessibilityLabel ?? `View ${p.name}’s workout`}
      accessibilityState={{ selected: !!p.selected }}
      hitSlop={Math.max(0, (44 - size) / 2)}
    >
      {ringed}
    </Pressable>
  ) : (
    ringed
  );
}
