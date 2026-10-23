import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, ScreenGlow } from "@/ui/components/foundation";
import { TogetherBtn } from "./TogetherBtn";
import { IconCheck, iconDefaults } from "@/ui/components/icons";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
import { TogetherEyebrow } from "./TogetherEyebrow";
import { LoadingSpinner } from "@/ui/components/LoadingSpinner";
import {
  NEARBY_CONNECTION_LABEL,
  ONLINE_CONNECTION_LABEL,
} from "./TogetherConnectionChoice";
import { color } from "@/ui/theme/tokens";

/** Canvas row 1 "Joining": connecting, then waiting for a non-partner's host to let you in. */
export function TogetherJoiningPresenter(p: {
  hostName?: string;
  connection: "local" | "online";
  step: "connect" | "ask";
  busy?: boolean;
  onCancel(): void;
}) {
  const insets = useSafeAreaInsets();
  const first = p.hostName?.split(/\s+/)[0] || "the host";
  const asking = p.step === "ask";
  const online = p.connection === "online";
  const item = (state: "done" | "active" | "todo", text: string) => (
    <View flexDirection="row" alignItems="center" gap={6} minHeight={20}>
      {state === "done" ? (
        <IconCheck {...iconDefaults({ size: 16 })} color={color.$success} />
      ) : state === "active" ? (
        <LoadingSpinner size="sm" accessibilityLabel="Searching" />
      ) : (
        <View
          width={14}
          height={14}
          marginHorizontal={1}
          borderRadius={99}
          borderWidth={1.5}
          borderColor="$text4"
        />
      )}
      <Text
        fontFamily="$body"
        fontSize={12}
        color={
          state === "done"
            ? "$success"
            : state === "active"
              ? "$primary"
              : "$text3"
        }
      >
        {text}
      </Text>
    </View>
  );
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="together-joining"
    >
      <ScreenGlow />
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        paddingHorizontal={20}
        gap={14}
      >
        <View
          width={96}
          height={96}
          borderRadius={99}
          borderWidth={2}
          borderColor="$primary"
          alignItems="center"
          justifyContent="center"
        >
          <TogetherAthleteAvatar
            name={p.hostName ?? "?"}
            size={72}
            tone="neutral"
          />
        </View>
        <TogetherEyebrow>
          {asking
            ? "Not a training partner yet"
            : online
              ? ONLINE_CONNECTION_LABEL
              : NEARBY_CONNECTION_LABEL}
        </TogetherEyebrow>
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={22}
          letterSpacing={-0.5}
          color="$text"
          textAlign="center"
          accessibilityLiveRegion="polite"
        >
          {asking
            ? `Waiting for ${first} to let you in`
            : `Connecting to ${first}’s phone`}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={13}
          lineHeight={19}
          color="$text2"
          textAlign="center"
          maxWidth={280}
        >
          {asking
            ? `${first} sees your name and photo, nothing else. You can keep this open or cancel.`
            : online
              ? "Needs internet. This usually takes a second or two."
              : "Keep Wi-Fi on. This can take up to 30 seconds."}
        </Text>
        <View alignSelf="stretch">
          <Card surface={0}>
            <View gap={8}>
              {item("done", `Found ${first}’s session`)}
              {item(
                "active",
                asking
                  ? `Asked ${first} to let you in`
                  : `Checking it is really ${first}`,
              )}
              {item("todo", "Start your workout")}
            </View>
          </Card>
        </View>
      </View>
      <View
        paddingHorizontal={20}
        paddingTop={12}
        paddingBottom={Math.max(insets.bottom, 30)}
      >
        <TogetherBtn variant="quiet" disabled={p.busy} onPress={p.onCancel}>
          Cancel
        </TogetherBtn>
      </View>
    </View>
  );
}
