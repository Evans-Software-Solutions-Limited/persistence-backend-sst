import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";

export const AUDIENCE_COPY: Record<TogetherLobbyAudience, string> = {
  "invite-only": "Only people with the code or QR.",
  friends:
    "Training partners join straight in. Others need the code, and you let them in.",
  open: "Anyone near you can ask. You let in people who are not partners.",
};

/** Canvas row 1b "Who can join": three equal segments; Open nearby is Nearby-only. */
export function TogetherAudienceSegment(p: {
  value: TogetherLobbyAudience;
  online: boolean;
  onChange(value: TogetherLobbyAudience): void;
  /** The explanatory line under the segment; the settings page has none (canvas row 4). */
  copy?: boolean;
  accessibilityLabel?: string;
}) {
  const options: [TogetherLobbyAudience, string][] = [
    ["invite-only", "Private"],
    ["friends", "Partners"],
    ["open", "Open nearby"],
  ];
  return (
    <View gap={14}>
      <View
        flexDirection="row"
        gap={4}
        padding={4}
        borderRadius={12}
        backgroundColor="$surface2"
        accessibilityRole="radiogroup"
        accessibilityLabel={p.accessibilityLabel ?? "Who can join"}
      >
        {options.map(([value, label]) => {
          const disabled = p.online && value === "open";
          const on = p.value === value;
          return (
            <Pressable
              key={value}
              style={{ flex: 1 }}
              disabled={disabled}
              onPress={() => p.onChange(value)}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: on, disabled }}
            >
              <View
                height={40}
                borderRadius={9}
                backgroundColor={on ? "$surface4" : "transparent"}
                alignItems="center"
                justifyContent="center"
                paddingHorizontal={4}
              >
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={12}
                  lineHeight={14}
                  textAlign="center"
                  color={disabled ? "$text4" : on ? "$text" : "$text3"}
                >
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {p.copy !== false && (
        <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
          {AUDIENCE_COPY[p.value]}
          {p.online ? " Open nearby works only with Nearby." : ""}
        </Text>
      )}
    </View>
  );
}
