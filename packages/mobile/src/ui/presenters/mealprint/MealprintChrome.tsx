import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GENERIC_PARTIAL_ENFORCEMENT_COPY,
  LABEL_CHECK_COPY,
  partialEnforcementCopy,
} from "@/domain/models/mealprint";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconWarning } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import { PlanTopBar } from "@/ui/presenters/fuel/plans/PlanChrome";

/**
 * Shared pieces of the Mealprint screens (PER-134, canvas N4 · N15–N27):
 * full screens with back, an eyebrow and one pinned footer; hero mono
 * numbers and hairline stat rows; the amber safety caveat. Pure.
 */

export const MACRO_COLOURS = {
  protein: toneHex("success").base,
  carbs: toneHex("primary").base,
  fat: toneHex("ember").base,
} as const;

/** Safety copy is amber (with an icon, never colour alone). */
export const AMBER = color.$warning;

export const fmtKcal = (n: number) => Math.round(n).toLocaleString("en-GB");

/** The page: top bar, a scrolling body and a pinned footer. */
export function MealprintPage({
  left,
  eyebrow,
  right,
  footer,
  children,
  scroll = true,
  testID,
}: {
  left: ReactNode;
  eyebrow: string;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  testID: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <PlanTopBar left={left} eyebrow={eyebrow} right={right} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View flex={1} paddingHorizontal={20}>
            {children}
          </View>
        )}
        {footer ? (
          <View
            paddingHorizontal={20}
            paddingTop={12}
            paddingBottom={insets.bottom + 16}
            gap={10}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/** The page title ("What should I eat?"). */
export function MealprintTitle({
  children,
  center = false,
  size = 34,
  marginTop = 4,
}: {
  children: string;
  center?: boolean;
  size?: number;
  marginTop?: number;
}) {
  return (
    <Text
      fontFamily="$display"
      fontSize={size}
      lineHeight={size + 6}
      fontWeight="800"
      letterSpacing={-1}
      color="$text"
      textAlign={center ? "center" : "left"}
      marginTop={marginTop}
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
}

/** The big mono number with its unit ("1,893 kcal"). */
export function HeroNumber({
  value,
  unit,
  size = 76,
  testID,
}: {
  value: string;
  unit: string;
  size?: number;
  testID?: string;
}) {
  return (
    <View flexDirection="row" alignItems="baseline" marginTop={4}>
      <Text
        fontFamily="$mono"
        fontSize={size}
        lineHeight={size + 4}
        fontWeight="700"
        letterSpacing={size > 50 ? -3 : -2}
        color="$text"
        testID={testID}
      >
        {value}
      </Text>
      <Text fontFamily="$body" fontSize={15} color="$text3" marginLeft={8}>
        {unit}
      </Text>
    </View>
  );
}

/** "LEFT TODAY", "WHAT'S IN IT" — the 12px uppercase label. */
export function SectionEyebrow({
  children,
  marginTop = 0,
}: {
  children: string;
  marginTop?: number;
}) {
  return (
    <Text
      fontFamily="$display"
      fontSize={12}
      fontWeight="600"
      letterSpacing={3}
      textTransform="uppercase"
      color="$text3"
      marginTop={marginTop}
    >
      {children}
    </Text>
  );
}

export type StripCell = { value: string; label: string; colour?: string };

/** The hairline three-column stat row (Protein · Carbs · Fat). */
export function StatStrip({
  cells,
  marginTop = 14,
  borderTop = true,
  accessibilityLabel,
  testID,
}: {
  cells: readonly StripCell[];
  marginTop?: number;
  borderTop?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <View
      marginTop={marginTop}
      flexDirection="row"
      borderTopWidth={borderTop ? 1 : 0}
      borderBottomWidth={1}
      borderColor="$border2"
      paddingVertical={10}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {cells.map((c, i) => (
        <View
          key={c.label}
          flex={1}
          gap={2}
          paddingLeft={i === 0 ? 0 : 12}
          borderLeftWidth={i === 0 ? 0 : 1}
          borderColor="$border"
        >
          <Text
            fontFamily="$mono"
            fontSize={16}
            fontWeight="700"
            color={c.colour ?? "$text"}
          >
            {c.value}
          </Text>
          <Text
            fontFamily="$display"
            fontSize={10}
            fontWeight="600"
            letterSpacing={1.6}
            textTransform="uppercase"
            color="$text3"
          >
            {c.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Protein / Carbs / Fat cells in their macro colours. */
export function macroCells(m: {
  proteinG: number;
  carbsG: number;
  fatG: number;
}): StripCell[] {
  return [
    {
      value: `${Math.round(m.proteinG)}g`,
      label: "Protein",
      colour: MACRO_COLOURS.protein,
    },
    {
      value: `${Math.round(m.carbsG)}g`,
      label: "Carbs",
      colour: MACRO_COLOURS.carbs,
    },
    {
      value: `${Math.round(m.fatG)}g`,
      label: "Fat",
      colour: MACRO_COLOURS.fat,
    },
  ];
}

/** The small P / C / F chips in macro colours (ideas list). */
export function MacroChips({
  proteinG,
  carbsG,
  fatG,
}: {
  proteinG: number;
  carbsG: number;
  fatG: number;
}) {
  const chip = (label: string, colour: string, dim: string) => (
    <View
      height={22}
      paddingHorizontal={8}
      borderRadius={9999}
      backgroundColor={dim}
      justifyContent="center"
    >
      <Text fontFamily="$mono" fontSize={11} fontWeight="600" color={colour}>
        {label}
      </Text>
    </View>
  );
  return (
    <View flexDirection="row" gap={6}>
      {chip(
        `${Math.round(proteinG)}P`,
        MACRO_COLOURS.protein,
        "rgba(52,211,153,0.12)",
      )}
      {chip(
        `${Math.round(carbsG)}C`,
        MACRO_COLOURS.carbs,
        "rgba(34,211,238,0.12)",
      )}
      {chip(`${Math.round(fatG)}F`, MACRO_COLOURS.fat, "rgba(251,146,60,0.12)")}
    </View>
  );
}

/** Amber safety copy with an icon — never colour alone. */
export function Caveat({
  children,
  marginTop = 14,
  testID,
}: {
  children: ReactNode;
  marginTop?: number;
  testID?: string;
}) {
  return (
    <View
      marginTop={marginTop}
      flexDirection="row"
      gap={10}
      borderWidth={1}
      borderColor="rgba(251,191,36,0.35)"
      backgroundColor="rgba(251,191,36,0.06)"
      borderRadius={14}
      paddingVertical={12}
      paddingHorizontal={14}
      testID={testID}
    >
      <IconWarning size={16} color={AMBER} />
      <View flex={1} gap={8}>
        {children}
      </View>
    </View>
  );
}

export function CaveatText({
  children,
  muted = false,
  testID,
}: {
  children: string;
  muted?: boolean;
  testID?: string;
}) {
  return (
    <Text
      fontFamily="$body"
      fontSize={12.5}
      lineHeight={18}
      color={muted ? "$text2" : "#E9E3D0"}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/**
 * The legal copy on every AI screen: `LABEL_CHECK_COPY` word for word, plus
 * the halal/kosher caveat built from the person's diet (or, when this phone
 * doesn't know it, the server's flag).
 */
export function AiCaveats({
  dietaryPatterns,
  serverPartialEnforcementOnly = false,
  testID,
}: {
  dietaryPatterns: readonly string[];
  serverPartialEnforcementOnly?: boolean;
  testID: string;
}) {
  const partial =
    partialEnforcementCopy(dietaryPatterns) ??
    (serverPartialEnforcementOnly ? GENERIC_PARTIAL_ENFORCEMENT_COPY : null);
  return (
    <>
      {partial ? (
        <Caveat testID={`${testID}-partial`}>
          <CaveatText>{partial}</CaveatText>
        </Caveat>
      ) : null}
      <Caveat testID={`${testID}-label-check`}>
        <CaveatText>{LABEL_CHECK_COPY}</CaveatText>
      </Caveat>
    </>
  );
}

/** The round 88pt icon at the top of the state screens. */
export function BigIcon({
  children,
  tone = "primary",
  marginTop = 40,
}: {
  children: ReactNode;
  tone?: "primary" | "success" | "amber" | "neutral";
  marginTop?: number;
}) {
  const bg =
    tone === "success"
      ? "rgba(52,211,153,0.10)"
      : tone === "amber"
        ? "rgba(251,191,36,0.10)"
        : tone === "neutral"
          ? "rgba(255,255,255,0.06)"
          : "rgba(34,211,238,0.10)";
  return (
    <View
      marginTop={marginTop}
      alignSelf="center"
      width={88}
      height={88}
      borderRadius={9999}
      alignItems="center"
      justifyContent="center"
      backgroundColor={bg}
    >
      {children}
    </View>
  );
}

/** A grey line of help text. */
export function Hint({
  children,
  center = false,
  marginTop = 0,
  testID,
}: {
  children: string;
  center?: boolean;
  marginTop?: number;
  testID?: string;
}) {
  return (
    <Text
      fontFamily="$body"
      fontSize={12}
      lineHeight={16}
      color="$text3"
      textAlign={center ? "center" : "left"}
      marginTop={marginTop}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/** "Occasion", "What are you after" — the 17px section heading. */
export function SectionTitle({
  children,
  optional = false,
}: {
  children: string;
  optional?: boolean;
}) {
  return (
    <Text fontFamily="$body" fontSize={17} fontWeight="700" color="$text">
      {children}
      {optional ? (
        <Text fontWeight="400" color="$text3">
          {" "}
          (optional)
        </Text>
      ) : null}
    </Text>
  );
}
