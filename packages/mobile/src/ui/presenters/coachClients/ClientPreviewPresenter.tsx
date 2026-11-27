import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CoachAvatar,
  Eyebrow,
  coachInitials,
} from "@/ui/presenters/coaching/coachingKit";

/**
 * C11s — Preview as the client: their Coach tab as it will look straight
 * after they accept (the welcome message, joining forms first, the
 * programme with Next, targets). Built from the set-up on this phone, so it
 * works offline.
 */
export type ClientPreviewPresenterProps = {
  clientFirst: string;
  coachName: string;
  programmeName: string | null;
  nextWorkout: string | null;
  welcome: string | null;
  forms: readonly { key: string; title: string; meta: string }[];
  targets: string | null;
  plans: readonly string[];
  resources: number;
  onClose: () => void;
};

function Row(p: {
  eyebrow?: string;
  title: string;
  sub?: string;
  action?: string;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={12}
      borderBottomWidth={1}
      borderBottomColor="$border"
      testID={p.testID}
    >
      <View flex={1} minWidth={0} gap={2}>
        {p.eyebrow ? (
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={10}
            letterSpacing={1.4}
            textTransform="uppercase"
            color="$text3"
          >
            {p.eyebrow}
          </Text>
        ) : null}
        <Text fontFamily="$body" fontWeight="600" fontSize={15} color="$text">
          {p.title}
        </Text>
        {p.sub ? (
          <Text fontFamily="$body" fontSize={12.5} color="$text3">
            {p.sub}
          </Text>
        ) : null}
      </View>
      {p.action ? (
        <View
          height={36}
          paddingHorizontal={14}
          borderRadius={9999}
          borderWidth={1}
          borderColor="rgba(34,211,238,0.45)"
          backgroundColor="rgba(34,211,238,0.10)"
          justifyContent="center"
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={13}
            color="#67E8F9"
          >
            {p.action}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function ClientPreviewPresenter(p: ClientPreviewPresenterProps) {
  const insets = useSafeAreaInsets();
  const coachFirst = p.coachName.split(" ")[0] ?? p.coachName;
  return (
    <View flex={1} paddingTop={insets.top} testID="client-preview">
      <View
        flexDirection="row"
        alignItems="center"
        gap={8}
        paddingHorizontal={20}
        height={52}
      >
        <Text
          flex={1}
          fontFamily="$body"
          fontWeight="600"
          fontSize={14}
          color="$text2"
        >
          {`Preview: what ${p.clientFirst} sees when they accept`}
        </Text>
        <Pressable
          onPress={p.onClose}
          accessibilityRole="button"
          testID="preview-close"
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={14}
            color="$accentTrainer"
          >
            Close
          </Text>
        </Pressable>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        <Eyebrow>Your coach</Eyebrow>
        <View flexDirection="row" alignItems="center" gap={12} marginTop={8}>
          <CoachAvatar
            initials={coachInitials(p.coachName)}
            size={44}
            fontSize={14}
          />
          <View flex={1}>
            <Text
              fontFamily="$body"
              fontWeight="800"
              fontSize={19}
              color="$text"
            >
              {p.coachName}
            </Text>
            <Text fontFamily="$body" fontSize={12.5} color="$text3">
              {p.programmeName
                ? `Your coach from today · ${p.programmeName}`
                : "Your coach from today"}
            </Text>
          </View>
        </View>
        {p.welcome ? (
          <View
            marginTop={14}
            padding={12}
            borderRadius={16}
            backgroundColor="$surface2"
            borderWidth={1}
            borderColor="$border2"
            testID="preview-welcome"
          >
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={12.5}
              color="#C4B5FD"
            >
              {coachFirst}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={14}
              lineHeight={20}
              color="$text"
            >
              {p.welcome}
            </Text>
          </View>
        ) : null}
        <View marginTop={10}>
          {p.forms.map((f, i) => (
            <Row
              key={f.key}
              eyebrow="Before you start"
              title={f.title}
              sub={f.meta}
              action={i === 0 ? "Fill in" : undefined}
              testID={`preview-form-${i}`}
            />
          ))}
          {p.programmeName ? (
            <Row
              title={p.programmeName}
              sub={p.nextWorkout ? `Next: ${p.nextWorkout}` : undefined}
              testID="preview-programme"
            />
          ) : null}
          {p.targets ? (
            <Row title="Targets" sub={p.targets} testID="preview-targets" />
          ) : null}
          {p.plans.map((name) => (
            <Row key={name} title={name} sub="Meal plan" />
          ))}
          {p.resources > 0 ? (
            <Row
              title="Resources"
              sub={`${p.resources} ${p.resources === 1 ? "resource" : "resources"}`}
              testID="preview-resources"
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
