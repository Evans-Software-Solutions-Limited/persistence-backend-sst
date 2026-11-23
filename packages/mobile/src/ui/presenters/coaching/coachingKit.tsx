import type { ReactNode } from "react";
import { Text, View } from "@tamagui/core";

/**
 * Small pieces shared by the PER-126 athlete coaching screens (C11j invite
 * preview, C2e/C11k Coach tab). Canvas values are copied from the boards'
 * `.av`, `.eb`, `.sec` and `.warn` styles.
 */

/** "Ellie Hart" → "EH". */
export function coachInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters
    .map((p) => p![0]!.toUpperCase())
    .join("")
    .slice(0, 2);
}

/** Canvas `.av` in the coach colour: violet ring on a violet wash. */
export function CoachAvatar(p: {
  initials: string;
  size: number;
  fontSize: number;
}) {
  return (
    <View
      width={p.size}
      height={p.size}
      borderRadius={9999}
      borderWidth={2}
      borderColor="$accentTrainer"
      backgroundColor="$accentTrainerGlow"
      alignItems="center"
      justifyContent="center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        fontFamily="$display"
        fontWeight="700"
        fontSize={p.fontSize}
        color="$accentTrainerBright"
      >
        {p.initials}
      </Text>
    </View>
  );
}

/** Canvas `.eb`: 11px uppercase, wide tracking. */
export function Eyebrow(p: { children: ReactNode; color?: string }) {
  return (
    <Text
      fontFamily="$body"
      fontWeight="600"
      fontSize={11}
      lineHeight={14}
      letterSpacing={2.6}
      textTransform="uppercase"
      color={p.color ?? "$text3"}
    >
      {p.children}
    </Text>
  );
}

/**
 * Canvas `.warn` (Leave / Sharing boards; C9c offline uses the same orange):
 * an ember dot and one line, on an ember wash.
 */
export function WarnNote(p: { children: ReactNode; testID?: string }) {
  return (
    <View
      flexDirection="row"
      alignItems="flex-start"
      gap={10}
      paddingVertical={10}
      paddingHorizontal={12}
      borderRadius={12}
      backgroundColor="$emberDim"
      borderWidth={1}
      borderColor="rgba(251,146,60,0.35)"
      accessibilityRole="alert"
      testID={p.testID}
    >
      <View
        width={6}
        height={6}
        borderRadius={9999}
        backgroundColor="$ember"
        marginTop={6}
      />
      <Text
        flex={1}
        fontFamily="$body"
        fontSize={12.5}
        lineHeight={17}
        color="$text2"
      >
        {p.children}
      </Text>
    </View>
  );
}
