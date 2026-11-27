import { Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";

import { Btn } from "@/ui/components/foundation/Btn";
import {
  IconChevronL,
  IconClipboard,
  IconLock,
  IconTimer,
} from "@/ui/components/icons";

/**
 * PER-130 — canvas C10q: every "when they join" form from one coach, in the
 * coach's order. "Later" leaves them waiting on the Coach tab; "Start the
 * first one" opens the first, and each one sent leads to the next.
 */

export type JoiningFormRow = {
  requestId: string;
  title: string;
  /** "14 questions · about 8 min". */
  detail: string;
};

export type JoiningFormsPresenterProps = {
  coachFirstName: string;
  headline: string;
  summary: { forms: number; questions: number; minutes: number };
  rows: readonly JoiningFormRow[];
  /** Brad's health-screening wording, once written (null until then). */
  healthCopy: string | null;
  onLater(): void;
  onStart(): void;
};

function Stat(p: {
  value: string;
  unit?: string;
  label: string;
  first: boolean;
}) {
  return (
    <View
      flex={1}
      minWidth={0}
      gap={3}
      paddingLeft={p.first ? 0 : 14}
      borderLeftWidth={p.first ? 0 : 1}
      borderLeftColor="rgba(255,255,255,0.08)"
    >
      <Text
        fontFamily="$mono"
        fontWeight="700"
        fontSize={20}
        lineHeight={24}
        letterSpacing={-0.5}
        color="$text"
      >
        {p.value}
        {p.unit ? (
          <Text
            fontFamily="$mono"
            fontWeight="500"
            fontSize={12}
            color="$text3"
          >
            {p.unit}
          </Text>
        ) : null}
      </Text>
      <Text
        fontFamily="$body"
        fontWeight="600"
        fontSize={10}
        lineHeight={12}
        letterSpacing={1.6}
        textTransform="uppercase"
        color="$text3"
      >
        {p.label}
      </Text>
    </View>
  );
}

export function JoiningFormsPresenter(p: JoiningFormsPresenterProps) {
  const insets = useSafeAreaInsets();
  return (
    <View flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      <View
        flexDirection="row"
        alignItems="center"
        paddingHorizontal={10}
        height={52}
      >
        <Pressable
          onPress={p.onLater}
          accessibilityRole="button"
          accessibilityLabel="Later"
          style={{ minHeight: 44, justifyContent: "center" }}
          testID="joining-later"
        >
          <View flexDirection="row" alignItems="center" gap={2}>
            <IconChevronL size={18} color="#C2C2CE" />
            <Text
              fontFamily="$body"
              fontWeight="500"
              fontSize={14}
              color="$text2"
            >
              Later
            </Text>
          </View>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 160 }}
        testID="joining-forms"
      >
        <Text
          fontFamily="$body"
          fontWeight="600"
          fontSize={12.5}
          color="$accentTrainer"
        >
          {`From ${p.coachFirstName} · before you start`}
        </Text>
        <Text
          fontFamily="$display"
          fontWeight="800"
          fontSize={30}
          lineHeight={36}
          letterSpacing={-0.8}
          color="$text"
          marginTop={8}
          marginBottom={6}
          accessibilityRole="header"
        >
          {p.headline}
        </Text>
        <Text fontFamily="$body" fontSize={14} lineHeight={20} color="$text2">
          {`${p.coachFirstName} asks everyone they coach to fill these in first, so they can plan around you.`}
        </Text>
        <View
          flexDirection="row"
          marginTop={18}
          paddingVertical={12}
          borderTopWidth={1}
          borderBottomWidth={1}
          borderColor="$border2"
          testID="joining-strip"
        >
          <Stat first value={String(p.summary.forms)} label="Forms" />
          <Stat
            first={false}
            value={String(p.summary.questions)}
            label="Questions"
          />
          <Stat
            first={false}
            value={String(p.summary.minutes)}
            unit="min"
            label="About"
          />
        </View>
        {p.rows.map((row) => (
          <View
            key={row.requestId}
            flexDirection="row"
            alignItems="center"
            gap={12}
            paddingVertical={12}
            borderBottomWidth={1}
            borderBottomColor="$border"
            testID={`joining-row-${row.requestId}`}
          >
            <IconClipboard size={20} color="#A78BFA" />
            <View flex={1} minWidth={0} gap={2}>
              <Text
                fontFamily="$body"
                fontWeight="500"
                fontSize={15}
                lineHeight={20}
                color="$text"
              >
                {row.title}
              </Text>
              <Text
                fontFamily="$body"
                fontSize={12}
                lineHeight={16}
                color="$text3"
              >
                {row.detail}
              </Text>
            </View>
            <View
              height={22}
              paddingHorizontal={8}
              borderRadius={9999}
              backgroundColor="rgba(255,255,255,0.06)"
              flexDirection="row"
              alignItems="center"
              gap={4}
            >
              <IconTimer size={12} color="#C2C2CE" />
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={11}
                color="$text2"
              >
                To do
              </Text>
            </View>
          </View>
        ))}
        <View flexDirection="row" gap={10} marginTop={14}>
          <IconLock size={16} color="#C2C2CE" />
          <Text
            flex={1}
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={18}
            color="$text2"
          >
            {p.healthCopy
              ? `Only ${p.coachFirstName} sees your answers. ${p.healthCopy}`
              : `Only ${p.coachFirstName} sees your answers.`}
          </Text>
        </View>
      </ScrollView>
      <View
        position="absolute"
        left={20}
        right={20}
        bottom={Math.max(insets.bottom, 12) + 22}
        gap={6}
      >
        <Btn
          variant="filled"
          tone="trainer"
          size="lg"
          full
          onPress={p.onStart}
          testID="joining-start"
        >
          Start the first one
        </Btn>
        <Text
          textAlign="center"
          fontFamily="$body"
          fontSize={12}
          color="$text3"
        >
          Saved as you go. They wait on your Coach tab.
        </Text>
      </View>
    </View>
  );
}
