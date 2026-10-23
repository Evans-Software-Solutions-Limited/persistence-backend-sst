import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

export const NEARBY_CONNECTION_LABEL = "Nearby · no internet needed";
export const ONLINE_CONNECTION_LABEL = "Online · internet required";
export type TogetherConnection = "local" | "online";

/** Two modes only (PER-64): Nearby or Online. Canvas rows 1b/1c "How you connect". */
export function TogetherConnectionChoice({
  value,
  onChange,
  onlineAvailable,
}: {
  value: TogetherConnection;
  onChange(value: TogetherConnection): void;
  onlineAvailable: boolean;
}) {
  const options: [TogetherConnection, string, string][] = [
    [
      "local",
      NEARBY_CONNECTION_LABEL,
      "Phones near each other. Wi-Fi on, no network needed.",
    ],
    ...(onlineAvailable
      ? [
          [
            "online",
            ONLINE_CONNECTION_LABEL,
            "Partners anywhere. Every phone needs internet.",
          ] as [TogetherConnection, string, string],
        ]
      : []),
  ];
  return (
    <View
      gap={8}
      accessibilityRole="radiogroup"
      accessibilityLabel="How you connect"
    >
      {options.map(([option, label, detail]) => {
        const selected = value === option;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected }}
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
                  color="$text"
                >
                  {label}
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
