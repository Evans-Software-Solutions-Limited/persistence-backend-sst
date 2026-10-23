import { Text, View } from "@tamagui/core";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
import { TogetherPill } from "./TogetherPill";

/** Canvas row 1b: a non-partner's request as a Let in / No bar under the strip. */
export function TogetherJoinRequestBar(p: {
  name: string;
  busy?: boolean;
  onAdmit(): void;
  onDeny(): void;
}) {
  return (
    <View paddingHorizontal={16} paddingTop={8}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={10}
        paddingVertical={10}
        paddingLeft={12}
        paddingRight={10}
        borderRadius={12}
        borderWidth={1}
        borderColor="$info"
        backgroundColor="rgba(96,165,250,0.12)"
        accessibilityRole="alert"
        testID="together-join-request"
      >
        <TogetherAthleteAvatar name={p.name} size={28} tone="info" />
        <View flex={1} gap={2}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={13}
            color="$text"
          >
            {p.name} wants to join
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            Not a training partner
          </Text>
        </View>
        <TogetherPill onPress={p.onDeny} disabled={p.busy}>
          No
        </TogetherPill>
        <TogetherPill tone="primary" onPress={p.onAdmit} disabled={p.busy}>
          Let in
        </TogetherPill>
      </View>
    </View>
  );
}
