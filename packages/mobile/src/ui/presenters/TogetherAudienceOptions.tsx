import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";

/** Canvas row 1c "Who can join" list. Open nearby is Nearby-only, so Online disables it. */
export function TogetherAudienceOptions({
  audience,
  online = false,
  onAudienceChange,
}: {
  audience: TogetherLobbyAudience;
  online?: boolean;
  onAudienceChange(value: TogetherLobbyAudience): void;
}) {
  const options: [TogetherLobbyAudience, string, string][] = [
    ["invite-only", "Private", "Code or QR only"],
    [
      "friends",
      "Training partners",
      "Partners join straight in. Others use the code.",
    ],
    [
      "open",
      "Open nearby",
      online
        ? "Nearby only. Pick Nearby to use it."
        : "Anyone near you can ask to join",
    ],
  ];
  return (
    <View
      gap={8}
      accessibilityRole="radiogroup"
      accessibilityLabel="Who can join"
    >
      {options.map(([value, title, detail]) => {
        const disabled = online && value === "open";
        const selected = audience === value && !disabled;
        return (
          <Pressable
            key={value}
            disabled={disabled}
            onPress={() => onAudienceChange(value)}
            accessibilityRole="radio"
            accessibilityLabel={title}
            accessibilityState={{ checked: selected, disabled }}
          >
            <View
              flexDirection="row"
              alignItems="flex-start"
              gap={12}
              padding={14}
              borderRadius={14}
              borderWidth={1}
              borderColor={selected ? "$primary" : "$border"}
              backgroundColor={selected ? "$primaryDim" : "$surface2"}
              opacity={disabled ? 0.5 : 1}
            >
              <View
                width={18}
                height={18}
                marginTop={1}
                borderRadius={9}
                borderWidth={1.5}
                borderColor={selected ? "$primary" : "$text4"}
                alignItems="center"
                justifyContent="center"
              >
                {selected && (
                  <View
                    width={8}
                    height={8}
                    borderRadius={4}
                    backgroundColor="$primary"
                  />
                )}
              </View>
              <View flex={1} gap={2}>
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={14}
                  color={disabled ? "$text3" : "$text"}
                >
                  {title}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  lineHeight={17}
                  color="$text3"
                >
                  {detail}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
