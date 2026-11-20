/**
 * Canvas primitives shared by the You page (Y1), History (Y2) and Recap
 * (Y4): the `.top` bar, `.eb3` eyebrow, `.sh` section head, `.nav` row,
 * `.strip`, `.lr` lift row and `.kv` row from `You.dc.html`.
 */

import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { IconChevronR } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/** Canvas `.ibtn`: a 44pt round icon button on a faint fill. */
export function IconButton(p: {
  label: string;
  onPress(): void;
  children: ReactNode;
  size?: number;
  testID?: string;
  tint?: "primary";
}) {
  const size = p.size ?? 44;
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      hitSlop={size < 44 ? (44 - size) / 2 : undefined}
      testID={p.testID}
    >
      <View
        width={size}
        height={size}
        borderRadius={999}
        backgroundColor={p.tint ? "$primaryDim" : "$border"}
        borderWidth={1}
        borderColor={p.tint ? "rgba(34,211,238,0.4)" : "$border2"}
        alignItems="center"
        justifyContent="center"
      >
        {p.children}
      </View>
    </Pressable>
  );
}

/** Canvas `.top`: left button, centred 19pt title, right slot. */
export function TopBar(p: {
  left: ReactNode;
  title: ReactNode;
  right: ReactNode;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingHorizontal={16}
      height={52}
    >
      {p.left}
      {typeof p.title === "string" ? (
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={19}
          lineHeight={24}
          color="$text"
          accessibilityRole="header"
        >
          {p.title}
        </Text>
      ) : (
        p.title
      )}
      {p.right}
    </View>
  );
}

/** Canvas `.eb3`: 12pt, 3pt tracking, uppercase, text3. */
export function Eyebrow(p: {
  children: string;
  marginTop?: number;
  color?: string;
}) {
  return (
    <Text
      marginTop={p.marginTop}
      fontFamily="$display"
      fontWeight="600"
      fontSize={12}
      lineHeight={16}
      letterSpacing={3}
      textTransform="uppercase"
      color={p.color ?? "$text3"}
      accessibilityRole="header"
    >
      {p.children}
    </Text>
  );
}

/** Canvas `.sh`: eyebrow left, optional cyan link right, 22pt above. */
export function SectionHead(p: {
  title: string;
  link?: { label: string; onPress(): void; testID?: string };
  marginTop?: number;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      marginTop={p.marginTop ?? 22}
      minHeight={32}
    >
      <Eyebrow>{p.title}</Eyebrow>
      {p.link && (
        <Pressable
          onPress={p.link.onPress}
          accessibilityRole="link"
          hitSlop={8}
          testID={p.link.testID}
        >
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={13}
            color="$primary"
          >
            {p.link.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Canvas `.nav`: leading slot, title + subtitle, trailing slot, hairline. */
export function NavRow(p: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  borderTop?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const body = (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={12}
      borderBottomWidth={1}
      borderTopWidth={p.borderTop ? 1 : 0}
      borderColor="rgba(255,255,255,0.07)"
    >
      {p.leading}
      <View flex={1} gap={2}>
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={15}
          lineHeight={20}
          color="$text"
        >
          {p.title}
        </Text>
        {!!p.subtitle && (
          <Text fontFamily="$body" fontSize={12} lineHeight={16} color="$text3">
            {p.subtitle}
          </Text>
        )}
      </View>
      {p.trailing ??
        (p.onPress ? <IconChevronR size={16} color={color.$text4} /> : null)}
    </View>
  );
  if (!p.onPress) return <View testID={p.testID}>{body}</View>;
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      testID={p.testID}
    >
      {body}
    </Pressable>
  );
}

/** Canvas `.strip`: three numbers with uppercase labels between hairlines. */
export function Strip(p: {
  items: readonly { value: string; label: string }[];
  marginTop?: number;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      marginTop={p.marginTop ?? 8}
      paddingVertical={10}
      borderTopWidth={1}
      borderBottomWidth={1}
      borderColor="$border2"
      testID={p.testID}
    >
      {p.items.map((item, i) => (
        <View
          key={item.label}
          flex={1}
          gap={2}
          paddingLeft={i ? 12 : 0}
          borderLeftWidth={i ? 1 : 0}
          borderColor="rgba(255,255,255,0.08)"
        >
          <Text
            fontFamily="$mono"
            fontWeight="700"
            fontSize={16}
            lineHeight={20}
            color="$text"
          >
            {item.value}
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={10}
            lineHeight={12}
            letterSpacing={1.6}
            textTransform="uppercase"
            color="$text3"
          >
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export type LiftRowData = {
  key: string;
  rank: string;
  name: string;
  detail: string;
  value: string;
  gold: boolean;
};

/** Canvas `.lr`: rank, name over a mono detail, value right (gold for records). */
export function LiftRow(p: { lift: LiftRowData; testID?: string }) {
  const l = p.lift;
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={10}
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.07)"
      testID={p.testID}
      accessible
      accessibilityLabel={`${l.rank}. ${l.name}, ${l.detail}, ${l.value}${l.gold ? ", record" : ""}`}
    >
      <Text width={18} fontFamily="$mono" fontSize={13} color="$text3">
        {l.rank}
      </Text>
      <View flex={1} minWidth={0} gap={2}>
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={15}
          lineHeight={20}
          color="$text"
          numberOfLines={1}
        >
          {l.name}
        </Text>
        <Text fontFamily="$mono" fontSize={12} lineHeight={16} color="$text3">
          {l.detail}
        </Text>
      </View>
      <Text
        fontFamily="$mono"
        fontWeight="700"
        fontSize={16}
        lineHeight={20}
        textAlign="right"
        color={l.gold ? "$gold" : "$text"}
      >
        {l.value}
      </Text>
    </View>
  );
}

/** Canvas `.kv`: label left, mono value right, hairline under. */
export function KeyValueRow(p: {
  label: string;
  value: string;
  good?: boolean;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingVertical={9}
      borderBottomWidth={1}
      borderColor="$border"
      testID={p.testID}
    >
      <Text fontFamily="$display" fontWeight="500" fontSize={14} color="$text">
        {p.label}
      </Text>
      <Text
        fontFamily="$mono"
        fontWeight="600"
        fontSize={14}
        color={p.good ? "$success" : "$text"}
      >
        {p.value}
      </Text>
    </View>
  );
}

/** Canvas legend swatches: Train → Rest across the four shades. */
export const SHADE_SWATCHES = [
  "rgba(34,211,238,0.25)",
  "rgba(34,211,238,0.5)",
  "rgba(34,211,238,0.75)",
  color.$primary,
] as const;
