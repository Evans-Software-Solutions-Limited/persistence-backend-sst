import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Card } from "@/ui/components/foundation";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
import { TogetherAudienceSegment } from "./TogetherAudienceSegment";
import { TogetherBtn } from "./TogetherBtn";
import { TogetherEyebrow } from "./TogetherEyebrow";
import { TogetherSwitch } from "./TogetherSwitch";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";
import {
  previousSummary,
  refusedCopy,
  type SharingChange,
  type SharingPerson,
  type TogetherSharingState,
} from "./togetherSharing";

const SUB = {
  numbers:
    "Off: partners see your progress through the plan, not weights or reps.",
  previous:
    "On by default. Partners see your last numbers in your Prev column, blank where you have none.",
  logging: "Anyone here could log on your record. Turn it off at any time.",
};

function Row(p: {
  title: string;
  detail?: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={12}
      borderTopWidth={p.first ? 0 : 1}
      borderColor="$border"
    >
      <View flex={1} gap={2}>
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={14}
          lineHeight={18}
          color="$text"
        >
          {p.title}
        </Text>
        {!!p.detail && (
          <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
            {p.detail}
          </Text>
        )}
      </View>
      {p.children}
    </View>
  );
}

/** A previous-values recipient: avatar in their strip colour, then their name. */
function Chip(p: { person: SharingPerson; on: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: p.on }}
      accessibilityLabel={`Share previous values with ${p.person.name}`}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={p.onPress}
      testID={`together-sharing-chip-${p.person.userId}`}
    >
      <View
        height={36}
        paddingLeft={6}
        paddingRight={12}
        borderRadius={999}
        flexDirection="row"
        alignItems="center"
        gap={6}
        borderWidth={1}
        borderColor={p.on ? "$primary" : "$border2"}
        backgroundColor={p.on ? "$primaryDim" : "$surface3"}
      >
        <TogetherAthleteAvatar
          name={p.person.name}
          size={24}
          tone={p.person.tone}
        />
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={12}
          color={p.on ? "$text" : "$text2"}
        >
          {p.person.name}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The three switches, shared by the in-session sheet (with explanations and
 * recipient chips) and Together settings' live card (labels end "in this
 * session", previous values summarised).
 */
export function TogetherSharingRows(p: {
  state: TogetherSharingState;
  onChange(change: SharingChange): void;
  variant: "sheet" | "card";
}) {
  const sheet = p.variant === "sheet";
  const label = (text: string) => (sheet ? text : `${text} in this session`);
  return (
    <>
      <Row
        title="Show my numbers"
        detail={sheet ? SUB.numbers : undefined}
        first
      >
        <TogetherSwitch
          accessibilityLabel={label("Show my numbers")}
          value={p.state.numbers}
          onValueChange={(value) => p.onChange({ key: "numbers", value })}
        />
      </Row>
      <Row
        title="Share previous values"
        detail={sheet ? SUB.previous : previousSummary(p.state)}
      >
        <TogetherSwitch
          accessibilityLabel={label("Share previous values")}
          value={p.state.previous}
          onValueChange={(value) => p.onChange({ key: "previous", value })}
        />
      </Row>
      {sheet && p.state.previous && p.state.recipients.length > 0 && (
        <View flexDirection="row" flexWrap="wrap" gap={8} paddingBottom={12}>
          {p.state.recipients.map((r) => (
            <Chip
              key={r.userId}
              person={r}
              on={r.on}
              onPress={() => p.onChange({ recipient: r.userId, value: !r.on })}
            />
          ))}
        </View>
      )}
      <Row
        title="Let others fill in my sets"
        detail={sheet ? SUB.logging : undefined}
      >
        <TogetherSwitch
          accessibilityLabel={label("Let others fill in my sets")}
          value={p.state.logging}
          onValueChange={(value) => p.onChange({ key: "logging", value })}
        />
      </Row>
    </>
  );
}

/**
 * Canvas row 4, phones 1–3 (`Sharing.dc.html`): the strip's settings cog.
 * Three switches that move on tap, recipient chips under previous values, one
 * notice when the session refuses a change, and Done.
 */
export function TogetherSharingPresenter(p: {
  visible: boolean;
  state: TogetherSharingState | null;
  onChange(change: SharingChange): void;
  /** The host's "Who can join"; left out where the session can't change it. */
  audience?: {
    value: TogetherLobbyAudience;
    online: boolean;
    onChange(value: TogetherLobbyAudience): void;
  };
  /** The host can still remove someone (a safety control the canvas leaves out). */
  removable?: readonly SharingPerson[];
  onRemove?(userId: string): void;
  onDone(): void;
}) {
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onDone}
      height="content"
      contentPadding={{ top: 4, bottom: 28 }}
      testID="together-sharing-settings"
    >
      <View gap={14}>
        <View gap={4}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={22}
            lineHeight={28}
            letterSpacing={-0.5}
            color="$text"
            accessibilityRole="header"
          >
            Together settings
          </Text>
          <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
            This session only. Defaults live in Train › Together › Settings.
          </Text>
        </View>
        {p.state ? (
          <>
            <TogetherEyebrow>What you share</TogetherEyebrow>
            <Card padX={14} padY={4}>
              <TogetherSharingRows
                state={p.state}
                onChange={p.onChange}
                variant="sheet"
              />
            </Card>
            {p.state.refused && (
              <View
                flexDirection="row"
                gap={10}
                alignItems="flex-start"
                paddingVertical={10}
                paddingHorizontal={12}
                borderRadius={12}
                borderWidth={1}
                borderColor="$ember"
                backgroundColor="$emberDim"
                accessibilityRole="alert"
                testID="together-sharing-refused"
              >
                <View
                  width={6}
                  height={6}
                  borderRadius={999}
                  backgroundColor="$ember"
                  marginTop={6}
                />
                <Text
                  flex={1}
                  fontFamily="$body"
                  fontSize={12}
                  lineHeight={17}
                  color="$text2"
                >
                  {refusedCopy(p.state.refused)}
                </Text>
              </View>
            )}
            {p.audience && (
              <>
                <TogetherEyebrow>Who can join</TogetherEyebrow>
                <TogetherAudienceSegment
                  value={p.audience.value}
                  online={p.audience.online}
                  onChange={p.audience.onChange}
                  copy={false}
                />
              </>
            )}
            {!!p.removable?.length && p.onRemove && (
              <Card padX={14} padY={4}>
                {p.removable.map((person, i) => (
                  <Row key={person.userId} title={person.name} first={i === 0}>
                    <TogetherBtn
                      variant="quiet"
                      size="md"
                      onPress={() => p.onRemove!(person.userId)}
                      accessibilityLabel={`Remove ${person.name} from the session`}
                    >
                      Remove
                    </TogetherBtn>
                  </Row>
                ))}
              </Card>
            )}
          </>
        ) : (
          <Text fontFamily="$body" fontSize={14} lineHeight={20} color="$text2">
            Sharing has ended. Your own workout carries on here.
          </Text>
        )}
        <View marginTop={4}>
          <TogetherBtn onPress={p.onDone} testID="together-sharing-done">
            Done
          </TogetherBtn>
        </View>
      </View>
    </BottomSheet>
  );
}
