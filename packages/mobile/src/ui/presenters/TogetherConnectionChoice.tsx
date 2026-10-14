import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation/Card";

export const NEARBY_CONNECTION_LABEL = "Nearby · no internet needed";
export const ONLINE_CONNECTION_LABEL = "Online · internet required";

/** Two modes only (PER-64, 14 Oct 2026): Nearby or Online. No same-Wi-Fi or hotspot choice. */
export function TogetherConnectionChoice({
  value,
  onChange,
  onlineAvailable,
}: {
  value: "local" | "online";
  onChange(value: "local" | "online"): void;
  onlineAvailable: boolean;
}) {
  const online = onlineAvailable && value === "online";
  return (
    <View gap={8}>
      <Text fontFamily="$display" fontSize={14} fontWeight="600" color="$text">
        Connection
      </Text>
      {onlineAvailable ? (
        <View
          gap={8}
          accessibilityRole="radiogroup"
          accessibilityLabel="Connection"
        >
          {(
            [
              ["local", NEARBY_CONNECTION_LABEL],
              ["online", ONLINE_CONNECTION_LABEL],
            ] as const
          ).map(([option, label]) => {
            const selected = value === option;
            return (
              <Card
                key={option}
                surface={1}
                pad={13}
                radius={12}
                onPress={() => onChange(option)}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ checked: selected }}
                accent={selected ? "primary" : undefined}
              >
                <View flexDirection="row" alignItems="center" gap={11}>
                  <View
                    width={16}
                    height={16}
                    borderRadius={8}
                    borderWidth={1.5}
                    borderColor={selected ? "$primary" : "$border3"}
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
                  <Text flex={1} fontFamily="$body" fontSize={13} color="$text">
                    {label}
                  </Text>
                </View>
              </Card>
            );
          })}
        </View>
      ) : (
        <Text fontFamily="$body" fontSize={13} color="$text2">
          {NEARBY_CONNECTION_LABEL}
        </Text>
      )}
      <Text fontFamily="$body" fontSize={12} color="$text3">
        {online
          ? "Partners join online through your invitation, or find it as training partners."
          : "Keep the phones close together, then start the session. No internet needed with valid offline access."}
      </Text>
    </View>
  );
}
