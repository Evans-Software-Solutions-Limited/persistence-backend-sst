import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
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
  return (
    <View gap={8}>
      <Text fontFamily="$display" fontSize={14} fontWeight="600" color="$text">
        Connection
      </Text>
      <Btn
        full
        variant={value === "local" ? "soft" : "outline"}
        onPress={() => onChange("local")}
      >
        {transport === "nearby" ? "Nearby phones" : "Same Wi-Fi or hotspot"}
      </Btn>
      {onlineAvailable && (
        <Btn
          full
          variant={value === "online" ? "soft" : "outline"}
          onPress={() => onChange("online")}
        >
          Online · internet required
        </Btn>
      )}
      <Text fontFamily="$body" fontSize={12} color="$text3">
        {value === "online"
          ? "Your training partners can find this session online."
          : "No internet needed with valid offline access. Share the session code or QR with your training partners."}
      </Text>
    </View>
  );
}
