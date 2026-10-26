import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { color } from "@/ui/theme/tokens";

/** Me is primary; partners take the info, success and gold rings in seat order (PER-60). `neutral` is the canvas `.av` (list rows). */
export type TogetherAvatarTone =
  | "primary"
  | "info"
  | "success"
  | "gold"
  | "neutral";
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
  neutral: color.$border2,
};

export function togetherToneColor(tone: TogetherAvatarTone): string {
  return RING[tone];
}

/** Canvas `.sa` / `.av` initials: 10pt at 22, 11pt at 26–28, 13pt at 36, a third of the size above that. */
export function togetherInitialsSize(size: number): number {
  if (size <= 22) return 10;
  if (size <= 28) return 11;
  if (size <= 36) return 13;
  return Math.round(size / 3);
}

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
  const tone = p.tone ?? "primary";
  const neutral = tone === "neutral";
  const ring = RING[tone];
  const face = (
    <View
      width={size}
      height={size}
      borderRadius={999}
      flexShrink={0}
      borderWidth={neutral ? 1 : 1.5}
      style={{ borderColor: ring }}
      backgroundColor={neutral ? "$surface3" : "$surface"}
      alignItems="center"
      justifyContent="center"
      testID="together-athlete-avatar"
    >
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={togetherInitialsSize(size)}
        style={{ color: neutral ? color.$text : ring }}
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
