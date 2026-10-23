import { ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { Link2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, ScreenGlow } from "@/ui/components/foundation";
import { TogetherBackButton } from "./TogetherBackButton";
import { TogetherBtn } from "./TogetherBtn";
import { IconCheck, IconEyeOff } from "@/ui/components/icons";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
import { TogetherEyebrow } from "./TogetherEyebrow";
import {
  NEARBY_CONNECTION_LABEL,
  ONLINE_CONNECTION_LABEL,
} from "./TogetherConnectionChoice";
import { color } from "@/ui/theme/tokens";

/** Canvas row 1 "Join this workout": one consent screen for a code, QR, row or cold start. */
export function TogetherJoinConsentPresenter(p: {
  /** Omitted when the host is not a partner and their name is unknown. */
  hostName?: string;
  workoutName: string;
  memberCount?: number;
  faces?: readonly string[];
  connection: "local" | "online";
  /** Opened from a QR with the app closed. */
  cold?: boolean;
  /** Not a training partner: the host has to let you in. */
  requiresApproval?: boolean;
  busy?: boolean;
  notice?: string;
  onBack(): void;
  onJoin(): void;
}) {
  const insets = useSafeAreaInsets();
  const online = p.connection === "online";
  const first = p.hostName?.split(/\s+/)[0] || undefined;
  const line = (icon: React.ReactNode, text: string, muted?: boolean) => (
    <View flexDirection="row" gap={10} alignItems="flex-start">
      <View marginTop={2}>{icon}</View>
      <Text
        flex={1}
        fontFamily="$body"
        fontSize={13}
        lineHeight={19}
        color={muted ? "$text3" : "$text2"}
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
      testID="together-join-consent"
    >
      <ScreenGlow />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 0,
          gap: 16,
        }}
      >
        <TogetherBackButton onPress={p.onBack} />
        {p.cold && (
          <View
            flexDirection="row"
            gap={10}
            alignItems="flex-start"
            paddingVertical={12}
            paddingHorizontal={14}
            borderRadius={14}
            borderWidth={1}
            style={{ borderColor: "rgba(34,211,238,0.35)" }}
            backgroundColor="$primaryDim"
          >
            <Link2 size={16} color={color.$primary} strokeWidth={1.75} />
            <Text
              flex={1}
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              color="$text2"
            >
              Opened from {first ? `${first}’s` : "their"} QR. If you had to
              sign in, you came straight back here.
            </Text>
          </View>
        )}
        <View gap={6}>
          <TogetherEyebrow>
            {first ? `${first}’s session` : "Shared session"}
          </TogetherEyebrow>
          <Text
            fontFamily="$display"
            fontWeight="800"
            fontSize={32}
            lineHeight={38}
            letterSpacing={-1}
            color="$text"
          >
            Join this workout
          </Text>
        </View>
        <Card surface={0}>
          <View gap={12}>
            <View flexDirection="row" alignItems="center" gap={12}>
              <View flexDirection="row">
                {(p.faces?.length ? p.faces : [p.hostName ?? "?"]).map(
                  (name, i) => (
                    <View key={`${name}-${i}`} marginRight={-6}>
                      <TogetherAthleteAvatar
                        name={name}
                        size={28}
                        tone="neutral"
                      />
                    </View>
                  ),
                )}
              </View>
              <View flex={1} paddingLeft={6} gap={2}>
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={14}
                  color="$text"
                >
                  {p.workoutName}
                </Text>
                {p.memberCount !== undefined && (
                  <Text
                    fontFamily="$body"
                    fontSize={12}
                    lineHeight={17}
                    color="$text3"
                  >
                    {p.memberCount} of 4
                  </Text>
                )}
              </View>
            </View>
            <Text
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              color="$text2"
            >
              {online ? ONLINE_CONNECTION_LABEL : NEARBY_CONNECTION_LABEL}
            </Text>
          </View>
        </Card>
        <Card surface={0}>
          <View gap={10}>
            <TogetherEyebrow>If you join</TogetherEyebrow>
            {line(
              <IconCheck size={16} color={color.$success} strokeWidth={1.75} />,
              "They see your name, photo and the sets you log here",
            )}
            {line(
              <IconCheck size={16} color={color.$success} strokeWidth={1.75} />,
              "You get your own saved workout, whenever you finish",
            )}
            {line(
              <IconEyeOff size={16} color={color.$text3} strokeWidth={1.75} />,
              "Nobody sees your history, weight, food or coaching",
              true,
            )}
          </View>
        </Card>
        {!!p.notice && (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$warning"
            accessibilityRole="alert"
          >
            {p.notice}
          </Text>
        )}
      </ScrollView>
      <View
        paddingHorizontal={20}
        paddingTop={12}
        paddingBottom={Math.max(insets.bottom, 30)}
        gap={10}
        backgroundColor="$bg"
      >
        <Text
          fontFamily="$body"
          fontSize={12}
          lineHeight={17}
          color="$text3"
          textAlign="center"
        >
          Joining starts your workout on this plan.
        </Text>
        <TogetherBtn disabled={p.busy} onPress={p.onJoin}>
          {p.requiresApproval
            ? `Ask ${first ?? "the host"} and start`
            : "Join and start"}
        </TogetherBtn>
      </View>
    </View>
  );
}
