import { ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenGlow } from "@/ui/components/foundation";
import { TogetherBackButton } from "./TogetherBackButton";
import { TogetherBtn } from "./TogetherBtn";
import { TogetherAudienceOptions } from "./TogetherAudienceOptions";
import {
  TogetherConnectionChoice,
  type TogetherConnection,
} from "./TogetherConnectionChoice";
import { TogetherEyebrow } from "./TogetherEyebrow";
import { TogetherPill } from "./TogetherPill";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";

/** Canvas row 1c "Start a shared session": workout, how you connect and who can join, asked once. */
export function TogetherStartSessionPresenter(p: {
  workoutName: string;
  workoutMeta: string;
  onChangeWorkout(): void;
  connection: TogetherConnection;
  onConnectionChange(value: TogetherConnection): void;
  onlineAvailable: boolean;
  audience: TogetherLobbyAudience;
  onAudienceChange(value: TogetherLobbyAudience): void;
  busy?: boolean;
  notice?: string;
  onStart(): void;
  onBack(): void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="together-start-session"
    >
      <ScreenGlow />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 0,
          gap: 14,
        }}
      >
        <TogetherBackButton onPress={p.onBack} />
        <View gap={6}>
          <TogetherEyebrow>Start a shared session</TogetherEyebrow>
          <Text
            fontFamily="$display"
            fontWeight="800"
            fontSize={32}
            lineHeight={38}
            letterSpacing={-1}
            color="$text"
          >
            Train together
          </Text>
        </View>
        <View accessibilityLabel={`Workout: ${p.workoutName}`}>
          <View
            flexDirection="row"
            alignItems="center"
            gap={12}
            padding={14}
            borderRadius={14}
            borderWidth={1}
            borderColor="$border"
            backgroundColor="$surface"
          >
            <View flex={1} gap={2}>
              <TogetherEyebrow>Workout</TogetherEyebrow>
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={16}
                lineHeight={18}
                color="$text"
              >
                {p.workoutName}
              </Text>
              <Text
                fontFamily="$body"
                fontSize={12}
                lineHeight={17}
                color="$text3"
              >
                {p.workoutMeta}
              </Text>
            </View>
            <TogetherPill
              onPress={p.onChangeWorkout}
              accessibilityLabel="Change workout"
            >
              Change
            </TogetherPill>
          </View>
        </View>
        <TogetherEyebrow>How you connect</TogetherEyebrow>
        <TogetherConnectionChoice
          value={p.connection}
          onChange={p.onConnectionChange}
          onlineAvailable={p.onlineAvailable}
        />
        <TogetherEyebrow>Who can join</TogetherEyebrow>
        <TogetherAudienceOptions
          audience={p.audience}
          online={p.connection === "online"}
          onAudienceChange={p.onAudienceChange}
        />
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
          Starts {p.workoutName} now. Up to 4 people.
        </Text>
        <TogetherBtn disabled={p.busy} onPress={p.onStart}>
          Start workout together
        </TogetherBtn>
      </View>
    </View>
  );
}
