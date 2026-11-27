import { Text, View } from "@tamagui/core";
import { CalendarCheck, SearchX } from "lucide-react-native";
import { Btn } from "@/ui/components/foundation";
import { NEUTRAL_HEX } from "@/ui/components/foundation/tones";
import {
  IconBolt,
  IconClock,
  IconTarget,
  IconWifiOff,
} from "@/ui/components/icons";
import { BackBtn } from "@/ui/presenters/fuel/plans/PlanChrome";
import { AMBER, BigIcon, MealprintPage } from "./MealprintChrome";

/**
 * <MealprintStatePresenter> — canvas N27 (PER-134): one layout for offline,
 * the daily limit, no match, a full day and Mealprint being unavailable.
 * `no_target` (no calorie target yet) is not on the canvas; it uses the same
 * layout. Pure.
 */

export type MealprintState =
  | "offline"
  | "cap"
  | "none"
  | "full"
  | "down"
  | "no_target";

type StateCopy = {
  title: string;
  body: string;
  primary: string | null;
  secondary: string;
  amber: boolean;
};

export const MEALPRINT_STATE_COPY: Readonly<Record<MealprintState, StateCopy>> =
  {
    offline: {
      title: "You're offline",
      body: "Mealprint needs a connection — try Quick Add instead.",
      primary: null,
      secondary: "Back to Log",
      amber: true,
    },
    cap: {
      title: "Back tomorrow",
      body: "You've used all of today's Mealprint suggestions — they reset tomorrow.",
      primary: null,
      secondary: "Close",
      amber: true,
    },
    none: {
      title: "Nothing matched your request",
      body: "We couldn't find meals that fit your request, targets and food preferences. Try another request or add your own foods and recipes. Your saved avoidances still apply.",
      primary: "Edit request",
      secondary: "Close",
      amber: false,
    },
    full: {
      title: "You're done for today",
      body: "There aren't enough calories left in your day for Mealprint to suggest anything worth logging.",
      primary: null,
      secondary: "Close",
      amber: false,
    },
    down: {
      title: "Try again shortly",
      body: "Mealprint is unavailable right now. Try again in a few minutes.",
      primary: "Try again",
      secondary: "Close",
      amber: true,
    },
    no_target: {
      title: "Set a target first",
      body: "Mealprint fills your calorie and macro target. Set one in Log, then come back.",
      primary: null,
      secondary: "Close",
      amber: false,
    },
  };

export type MealprintStateProps = {
  state: MealprintState;
  onBack: () => void;
  /** "Edit request" / "Try again" — only for the states that have one. */
  onPrimary: () => void;
  onSecondary: () => void;
  testID?: string;
};

function StateIcon({ state }: { state: MealprintState }) {
  const colour = MEALPRINT_STATE_COPY[state].amber ? AMBER : NEUTRAL_HEX.text2;
  switch (state) {
    case "offline":
      return <IconWifiOff size={36} color={colour} />;
    case "cap":
      return <IconClock size={36} color={colour} />;
    case "none":
      return <SearchX size={36} color={colour} />;
    case "full":
      return <CalendarCheck size={36} color={colour} />;
    case "no_target":
      return <IconTarget size={36} color={colour} />;
    default:
      return <IconBolt size={36} color={colour} />;
  }
}

export function MealprintStatePresenter({
  state,
  onBack,
  onPrimary,
  onSecondary,
  testID = "mealprint-state",
}: MealprintStateProps) {
  const copy = MEALPRINT_STATE_COPY[state];
  return (
    <MealprintPage
      testID={`${testID}-${state}`}
      scroll={false}
      left={<BackBtn onPress={onBack} testID={`${testID}-back`} />}
      eyebrow="Mealprint"
      footer={
        <>
          {copy.primary ? (
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              onPress={onPrimary}
              testID={`${testID}-primary`}
            >
              {copy.primary}
            </Btn>
          ) : null}
          <Btn
            variant="outline"
            tone="primary"
            size="lg"
            full
            onPress={onSecondary}
            testID={`${testID}-secondary`}
          >
            {copy.secondary}
          </Btn>
        </>
      }
    >
      <View alignItems="center">
        <BigIcon marginTop={120} tone={copy.amber ? "amber" : "neutral"}>
          <StateIcon state={state} />
        </BigIcon>
        <Text
          marginTop={28}
          fontFamily="$display"
          fontSize={26}
          lineHeight={32}
          fontWeight="800"
          letterSpacing={-0.5}
          color="$text"
          textAlign="center"
          accessibilityRole="header"
        >
          {copy.title}
        </Text>
        <Text
          marginTop={10}
          maxWidth={320}
          fontFamily="$body"
          fontSize={14}
          lineHeight={20}
          color="$text2"
          textAlign="center"
        >
          {copy.body}
        </Text>
      </View>
    </MealprintPage>
  );
}
