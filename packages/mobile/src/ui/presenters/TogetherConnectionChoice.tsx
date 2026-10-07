import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation/Card";
import type { TogetherTransport } from "@/domain/ports/togetherLobby.port";

export function TogetherConnectionChoice({
  value,
  onChange,
  onlineAvailable,
  transport,
}: {
  value: "local" | "online";
  onChange(value: "local" | "online"): void;
  onlineAvailable: boolean;
  transport?: TogetherTransport;
}) {
  const localLabel =
    transport === "nearby" ? "Nearby phones" : "Same Wi-Fi or hotspot";
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
              ["local", localLabel],
              ["online", "Online · internet required"],
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
          {localLabel}
        </Text>
      )}
      <Text fontFamily="$body" fontSize={12} color="$text3">
        {online
          ? "Your training partners can find this session online."
          : transport === "nearby"
            ? "Keep the phones nearby, then start the session. No internet needed with valid offline access."
            : "Connect both phones to the same Wi-Fi or hotspot, then start the session. No internet needed with valid offline access."}
      </Text>
    </View>
  );
}
