import type { ReactNode } from "react";
import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";

import { IconBack, IconChevronR, IconX } from "@/ui/components/icons";
import { DAY_CHIPS } from "@/domain/services/coachForms.service";
import { EDITED_ELSEWHERE } from "@/domain/models/coachForms";

/**
 * PER-129 shared pieces for the coach forms boards (C10g/h/j, C3.3b). Values
 * come from the boards' `.row`, `.st`, `.lk`, `.pl`, `.seg`, `.day`, `.fld`
 * and `.fl` styles, in the app's tokens.
 */

const VIOLET = "$accentTrainer";

/** C10g section head: a rule above, 14.5 semibold title, optional "+ Add". */
export function SectionHead(p: {
  title: string;
  onAdd?: () => void;
  addLabel?: string;
  first?: boolean;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={8}
      marginTop={p.first ? 12 : 10}
      paddingTop={12}
      borderTopWidth={1}
      borderTopColor="$border2"
      testID={p.testID}
    >
      <Text
        flex={1}
        fontFamily="$body"
        fontWeight="600"
        fontSize={14.5}
        lineHeight={20}
        color="$text"
      >
        {p.title}
      </Text>
      {p.onAdd ? (
        <Pressable
          onPress={p.onAdd}
          accessibilityRole="button"
          accessibilityLabel={p.addLabel ?? `Add to ${p.title}`}
          hitSlop={10}
          testID={p.testID ? `${p.testID}-add` : undefined}
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={12.5}
            color="$accentTrainer"
          >
            + Add
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Canvas `.eb` section label with an optional "+ Add" (C3.3b). */
export function EyebrowHead(p: {
  title: string;
  onAdd?: () => void;
  addLabel?: string;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="baseline"
      gap={8}
      marginBottom={8}
      testID={p.testID}
    >
      <Text
        flex={1}
        fontFamily="$body"
        fontWeight="600"
        fontSize={11}
        lineHeight={14}
        letterSpacing={2.6}
        textTransform="uppercase"
        color="$text3"
      >
        {p.title}
      </Text>
      {p.onAdd ? (
        <Pressable
          onPress={p.onAdd}
          accessibilityRole="button"
          accessibilityLabel={p.addLabel ?? "Add"}
          hitSlop={10}
          testID={p.testID ? `${p.testID}-add` : undefined}
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={12.5}
            color="$accentTrainer"
          >
            + Add
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Canvas `.row`: title, grey line, something on the right, chevron. */
export function ListRow(p: {
  title: string;
  subtitle?: string;
  subtitleTone?: "muted" | "warn";
  right?: ReactNode;
  leading?: ReactNode;
  onPress?: () => void;
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
      borderBottomColor="$border"
    >
      {p.leading}
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
        {p.subtitle ? (
          <Text
            fontFamily="$body"
            fontSize={12}
            lineHeight={16}
            color={p.subtitleTone === "warn" ? "$warning" : "$text3"}
            numberOfLines={1}
          >
            {p.subtitle}
          </Text>
        ) : null}
      </View>
      {p.right}
      {p.onPress ? <IconChevronR size={16} color="#5C5C68" /> : null}
    </View>
  );
  if (!p.onPress) return <View testID={p.testID}>{body}</View>;
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel ?? p.title}
      testID={p.testID}
    >
      {body}
    </Pressable>
  );
}

/** C10g "13/14" count, muted "—" when nobody has it. */
export function CountText(p: { text: string; muted: boolean }) {
  return (
    <Text
      fontFamily="$mono"
      fontWeight="600"
      fontSize={12.5}
      color={p.muted ? "$text4" : "$text"}
    >
      {p.text}
    </Text>
  );
}

export type PillTone = "done" | "waiting" | "paused" | "review";

const PILL: Record<PillTone, { bg: string; fg: string }> = {
  done: { bg: "rgba(52,211,153,0.12)", fg: "#34D399" },
  waiting: { bg: "rgba(251,191,36,0.12)", fg: "#FBBF24" },
  paused: { bg: "rgba(255,255,255,0.06)", fg: "#C2C2CE" },
  review: { bg: "rgba(167,139,250,0.14)", fg: "#C4B5FD" },
};

/** Canvas `.pl`: 22pt pill, 11 semibold. */
export function StatusPill(p: {
  tone: PillTone;
  text: string;
  testID?: string;
}) {
  const c = PILL[p.tone];
  return (
    <View
      height={22}
      paddingHorizontal={8}
      borderRadius={9999}
      backgroundColor={c.bg}
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      testID={p.testID}
    >
      <Text fontFamily="$body" fontWeight="600" fontSize={11} color={c.fg}>
        {p.text}
      </Text>
    </View>
  );
}

/** A dashed "In development" block (PER-126 Coach-tab placeholder style). */
export function InDevelopment(p: {
  title: string;
  ticket?: string;
  testID?: string;
}) {
  return (
    <View
      paddingVertical={12}
      paddingHorizontal={14}
      marginTop={12}
      borderRadius={12}
      borderWidth={1}
      borderStyle="dashed"
      borderColor="$border3"
      gap={2}
      testID={p.testID}
    >
      <Text fontFamily="$body" fontWeight="600" fontSize={14} color="$text2">
        {p.title}
      </Text>
      <Text fontFamily="$body" fontSize={12} color="$text3">
        {p.ticket
          ? `In development (${p.ticket}). Not in this build yet.`
          : "In development. Not in this build yet."}
      </Text>
    </View>
  );
}

/** Ember note (C9c offline style) with one line. */
export function Note(p: {
  children: ReactNode;
  onDismiss?: () => void;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={10}
      paddingVertical={10}
      paddingHorizontal={12}
      marginTop={10}
      borderRadius={12}
      backgroundColor="$emberDim"
      borderWidth={1}
      borderColor="rgba(251,146,60,0.35)"
      accessibilityRole="alert"
      testID={p.testID}
    >
      <View width={6} height={6} borderRadius={9999} backgroundColor="$ember" />
      <Text
        flex={1}
        fontFamily="$body"
        fontSize={12.5}
        lineHeight={17}
        color="$text2"
      >
        {p.children}
      </Text>
      {p.onDismiss ? (
        <Pressable
          onPress={p.onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={10}
          testID={p.testID ? `${p.testID}-dismiss` : undefined}
        >
          <IconX size={14} color="#C2C2CE" />
        </Pressable>
      ) : null}
    </View>
  );
}

/** 409 notice: the server copy is showing. */
export function EditedElsewhere(p: {
  onDismiss?: () => void;
  testID?: string;
}) {
  return (
    <Note onDismiss={p.onDismiss} testID={p.testID ?? "edited-elsewhere"}>
      {EDITED_ELSEWHERE}
    </Note>
  );
}

export const OFFLINE_COPY =
  "You're offline. Changes are saved on this phone and send when you're back.";

export function OfflineNote(p: { testID?: string }) {
  return <Note testID={p.testID ?? "coach-forms-offline"}>{OFFLINE_COPY}</Note>;
}

/** Canvas `.fl`: field label. */
export function FieldLabel(p: { children: ReactNode; top?: number }) {
  return (
    <Text
      fontFamily="$body"
      fontWeight="600"
      fontSize={12.5}
      lineHeight={16}
      color="$text2"
      marginTop={p.top ?? 12}
      marginBottom={6}
    >
      {p.children}
    </Text>
  );
}

/** Canvas `.seg`: equal-width segmented buttons. */
export function SegRow<T extends string>(p: {
  options: readonly { value: T; label: string; disabled?: boolean }[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      padding={3}
      gap={2}
      borderRadius={12}
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$border2"
      accessibilityRole="radiogroup"
      accessibilityLabel={p.label}
      testID={p.testID}
    >
      {p.options.map((o) => {
        const on = o.value === p.value;
        return (
          <Pressable
            key={o.value}
            style={{ flex: 1 }}
            onPress={() => p.onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!o.disabled }}
            testID={p.testID ? `${p.testID}-${o.value}` : undefined}
          >
            <View
              height={38}
              borderRadius={9}
              alignItems="center"
              justifyContent="center"
              backgroundColor={on ? "rgba(167,139,250,0.18)" : "transparent"}
              borderWidth={1}
              borderColor={on ? "rgba(167,139,250,0.5)" : "transparent"}
              opacity={o.disabled ? 0.45 : 1}
            >
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={13.5}
                color={on ? "$text" : "$text2"}
              >
                {o.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Canvas `.day` chips, Mo–Su (weekday 1–7). */
export function DayChips(p: {
  value: number | null;
  onChange: (weekday: number) => void;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      justifyContent="space-between"
      accessibilityRole="radiogroup"
      accessibilityLabel="Day"
      testID={p.testID}
    >
      {DAY_CHIPS.map((label, i) => {
        const day = i + 1;
        const on = p.value === day;
        return (
          <Pressable
            key={label}
            onPress={() => p.onChange(day)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            testID={p.testID ? `${p.testID}-${day}` : undefined}
          >
            <View
              width={44}
              height={44}
              borderRadius={9999}
              alignItems="center"
              justifyContent="center"
              borderWidth={1}
              borderColor={on ? VIOLET : "$border2"}
              backgroundColor={on ? VIOLET : "$surface"}
            >
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={13}
                color={on ? "$accentTrainerInk" : "$text2"}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Canvas `.fld`: a 44pt field-looking button. */
export function FieldButton(p: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  trailing?: ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      testID={p.testID}
    >
      <View
        height={44}
        borderRadius={12}
        backgroundColor="$surface2"
        borderWidth={1}
        borderColor="$border2"
        flexDirection="row"
        alignItems="center"
        gap={10}
        paddingHorizontal={14}
      >
        <View flex={1} flexDirection="row" alignItems="center" gap={10}>
          {typeof p.children === "string" ? (
            <Text
              fontFamily="$body"
              fontWeight="500"
              fontSize={14}
              color="$text"
            >
              {p.children}
            </Text>
          ) : (
            p.children
          )}
        </View>
        {p.trailing}
      </View>
    </Pressable>
  );
}

/** Canvas `.fld` as a text input. */
export function FieldInput(p: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  accessibilityLabel: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric" | "numbers-and-punctuation";
  maxLength?: number;
  testID?: string;
}) {
  return (
    <TextInput
      value={p.value}
      onChangeText={p.onChangeText}
      placeholder={p.placeholder}
      placeholderTextColor="#5C5C68"
      accessibilityLabel={p.accessibilityLabel}
      multiline={p.multiline}
      keyboardType={p.keyboardType}
      maxLength={p.maxLength}
      testID={p.testID}
      style={{
        minHeight: 44,
        borderRadius: 12,
        backgroundColor: "#1A1D29",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        paddingHorizontal: 14,
        paddingVertical: p.multiline ? 10 : 0,
        color: "#F4F4F8",
        fontFamily: "Geist",
        fontSize: 14,
        textAlignVertical: p.multiline ? "top" : "center",
      }}
    />
  );
}

/** A violet 13pt text link (`.lk`). */
export function LinkButton(p: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!p.disabled }}
      testID={p.testID}
      style={{ minHeight: 40, justifyContent: "center" }}
    >
      <Text
        fontFamily="$body"
        fontWeight="600"
        fontSize={13}
        color={p.disabled ? "$text4" : "$accentTrainer"}
      >
        {p.children}
      </Text>
    </Pressable>
  );
}

/** Canvas `.tg`: a 44×26 switch with a label and a grey line. */
export function ToggleRow(p: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={() => p.onChange(!p.value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: p.value }}
      accessibilityLabel={p.label}
      testID={p.testID}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={10}
      >
        <View flex={1} gap={2}>
          <Text fontFamily="$body" fontWeight="600" fontSize={14} color="$text">
            {p.label}
          </Text>
          {p.detail ? (
            <Text fontFamily="$body" fontSize={12} color="$text3">
              {p.detail}
            </Text>
          ) : null}
        </View>
        <View
          width={44}
          height={26}
          borderRadius={9999}
          padding={3}
          flexDirection="row"
          justifyContent={p.value ? "flex-end" : "flex-start"}
          backgroundColor={p.value ? VIOLET : "$surface4"}
        >
          <View
            width={20}
            height={20}
            borderRadius={9999}
            backgroundColor={p.value ? "$accentTrainerInk" : "$text2"}
          />
        </View>
      </View>
    </Pressable>
  );
}

/** Wrapping choice chips (canvas `.chip`, `.chip.on`). */
export function ChoiceChips<T extends string>(p: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      flexWrap="wrap"
      gap={8}
      accessibilityRole="radiogroup"
      accessibilityLabel={p.label}
      testID={p.testID}
    >
      {p.options.map((o) => {
        const on = o.value === p.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => p.onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            testID={p.testID ? `${p.testID}-${o.value}` : undefined}
          >
            <View
              height={34}
              paddingHorizontal={13}
              borderRadius={9999}
              alignItems="center"
              justifyContent="center"
              borderWidth={1}
              borderColor={on ? "rgba(167,139,250,0.5)" : "$border2"}
              backgroundColor={on ? "rgba(167,139,250,0.14)" : "$surface"}
            >
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={13}
                color={on ? "$text" : "$text2"}
              >
                {o.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Back link (canvas: chevron + "Forms" / "Clients"). */
export function BackLink(p: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${p.label}`}
      testID={p.testID}
      style={{ minHeight: 44, justifyContent: "center" }}
    >
      <View flexDirection="row" alignItems="center" gap={2}>
        <IconBack size={18} color="#C2C2CE" />
        <Text fontFamily="$body" fontWeight="500" fontSize={14} color="$text2">
          {p.label}
        </Text>
      </View>
    </Pressable>
  );
}
