import type { ReactNode } from "react";
import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { FileText, Image as ImageGlyph } from "lucide-react-native";

import {
  IconCheck,
  IconChevronR,
  IconLink,
  IconSearch,
} from "@/ui/components/icons";
import type { ResourceKind } from "@/domain/models/coachResources";

/**
 * PER-143 pieces shared by the resources screens (C3.7b/c, Library →
 * Resources, the athlete's Coach tab). Values follow the boards' `.row`,
 * `.pl`, `.box` and search field styles, in the app's tokens.
 */

/** The row icon: link, image or document. */
export function ResourceGlyph(p: {
  kind: ResourceKind;
  mime: string | null;
  color?: string;
}) {
  const color = p.color ?? "#8A8A98";
  if (p.kind === "link") return <IconLink size={20} color={color} />;
  if (p.mime?.startsWith("image/")) {
    return <ImageGlyph size={20} color={color} />;
  }
  return <FileText size={20} color={color} />;
}

/** Canvas `.row` for a resource: icon, name, grey line, right side. */
export function ResourceRow(p: {
  kind: ResourceKind;
  mime: string | null;
  title: string;
  subtitle: string;
  right?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "checkbox";
  accessibilityState?: { checked?: boolean; disabled?: boolean };
  testID?: string;
}) {
  const body = (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={12}
      borderBottomWidth={1}
      borderBottomColor="$border"
    >
      <ResourceGlyph kind={p.kind} mime={p.mime} />
      <View flex={1} minWidth={0} gap={2}>
        <Text
          fontFamily="$body"
          fontWeight="500"
          fontSize={15}
          lineHeight={20}
          color="$text"
          numberOfLines={1}
        >
          {p.title}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={12}
          lineHeight={16}
          color="$text3"
          numberOfLines={1}
        >
          {p.subtitle}
        </Text>
      </View>
      {p.right}
      {p.chevron ? <IconChevronR size={16} color="#5C5C68" /> : null}
    </View>
  );
  if (!p.onPress && !p.onLongPress) {
    return <View testID={p.testID}>{body}</View>;
  }
  return (
    <Pressable
      onPress={p.onPress}
      onLongPress={p.onLongPress}
      accessibilityRole={p.accessibilityRole ?? "button"}
      accessibilityState={p.accessibilityState}
      accessibilityLabel={p.accessibilityLabel ?? p.title}
      testID={p.testID}
    >
      {body}
    </Pressable>
  );
}

/** C3.7 "Opened" / "Not opened" pill. */
export function OpenedPill(p: { opened: boolean; testID?: string }) {
  return (
    <View
      height={22}
      paddingHorizontal={8}
      borderRadius={9999}
      flexDirection="row"
      alignItems="center"
      gap={4}
      flexShrink={0}
      backgroundColor={
        p.opened ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.06)"
      }
      testID={p.testID}
    >
      {p.opened ? <IconCheck size={12} color="#34D399" /> : null}
      <Text
        fontFamily="$body"
        fontWeight="600"
        fontSize={11}
        color={p.opened ? "#34D399" : "#C2C2CE"}
      >
        {p.opened ? "Opened" : "Not opened"}
      </Text>
    </View>
  );
}

/** Canvas `.box`: the picker's tick box. */
export function TickBox(p: { checked: boolean }) {
  return (
    <View
      width={24}
      height={24}
      borderRadius={7}
      borderWidth={1.5}
      borderColor={p.checked ? "$accentTrainer" : "$border3"}
      backgroundColor={p.checked ? "$accentTrainer" : "transparent"}
      alignItems="center"
      justifyContent="center"
    >
      {p.checked ? <IconCheck size={14} color="#1E1B4B" /> : null}
    </View>
  );
}

/** The search field at the top of the picker and the library. */
export function SearchField(p: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={8}
      height={44}
      paddingHorizontal={14}
      borderRadius={12}
      backgroundColor="$surface2"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
    >
      <IconSearch size={16} color="#8A8A98" />
      <TextInput
        value={p.value}
        onChangeText={p.onChangeText}
        placeholder={p.placeholder}
        placeholderTextColor="#5C5C68"
        accessibilityLabel={p.placeholder}
        autoCorrect={false}
        testID={p.testID}
        style={{
          flex: 1,
          color: "#F4F4F8",
          fontFamily: "Geist",
          fontSize: 14,
        }}
      />
    </View>
  );
}

/** A small outlined button (`.btn sm`). */
export function SmallButton(p: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  filled?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!p.disabled }}
      accessibilityLabel={p.label}
      testID={p.testID}
    >
      <View
        height={40}
        paddingHorizontal={14}
        borderRadius={9999}
        flexDirection="row"
        alignItems="center"
        gap={6}
        opacity={p.disabled ? 0.45 : 1}
        backgroundColor={p.filled ? "$accentTrainer" : "transparent"}
        borderWidth={p.filled ? 0 : 1}
        borderColor="$border3"
      >
        {p.icon}
        <Text
          fontFamily="$body"
          fontWeight="600"
          fontSize={13.5}
          color={p.filled ? "#1E1B4B" : "$text"}
        >
          {p.label}
        </Text>
      </View>
    </Pressable>
  );
}

/** Field error text under an input. */
export function FieldError(p: { message?: string; testID?: string }) {
  return p.message ? (
    <Text
      fontFamily="$body"
      fontSize={12}
      color="#FCA5A5"
      marginTop={4}
      testID={p.testID}
    >
      {p.message}
    </Text>
  ) : null;
}
