import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation";
import { TogetherBtn } from "./TogetherBtn";
import { IconWifiOff, IconX, iconDefaults } from "@/ui/components/icons";
import { TogetherAudienceSegment } from "./TogetherAudienceSegment";
import {
  TogetherConnectionChoice,
  type TogetherConnection,
} from "./TogetherConnectionChoice";
import { TogetherEyebrow } from "./TogetherEyebrow";
import { TogetherPill } from "./TogetherPill";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";
import { color } from "@/ui/theme/tokens";

/** Canvas row 1b: one sheet with how you connect and who can join, preset from Together settings. */
export function TogetherStartSheet(p: {
  visible: boolean;
  onClose(): void;
  connection: TogetherConnection;
  onConnectionChange(value: TogetherConnection): void;
  onlineAvailable: boolean;
  audience: TogetherLobbyAudience;
  onAudienceChange(value: TogetherLobbyAudience): void;
  /** The last Nearby start failed because the radio is off (host advertising refused). */
  wifiOff?: boolean;
  onOpenSettings?(): void;
  onRetry?(): void;
  onStart(): void;
  busy?: boolean;
  notice?: string;
}) {
  const online = p.connection === "online";
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      height="tall"
      testID="together-start-sheet"
      footer={
        !p.wifiOff ? (
          <TogetherBtn disabled={p.busy} onPress={p.onStart}>
            Start the session
          </TogetherBtn>
        ) : undefined
      }
    >
      <View gap={14}>
        <View flexDirection="row" alignItems="flex-start" gap={12}>
          <View flex={1} gap={4}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={22}
              letterSpacing={-0.5}
              color="$text"
            >
              Train together
            </Text>
            <Text
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              color="$text3"
            >
              Picked from your Together settings. Change them for this session
              here.
            </Text>
          </View>
          <TogetherPill
            onPress={p.onClose}
            accessibilityLabel="Close"
            icon={<IconX {...iconDefaults({ size: 16 })} />}
          />
        </View>
        <TogetherEyebrow>How you connect</TogetherEyebrow>
        <TogetherConnectionChoice
          value={p.connection}
          onChange={p.onConnectionChange}
          onlineAvailable={p.onlineAvailable}
        />
        <TogetherEyebrow>Who can join</TogetherEyebrow>
        <TogetherAudienceSegment
          value={p.audience}
          online={online}
          onChange={p.onAudienceChange}
        />
        {p.wifiOff && (
          <View gap={8}>
            <View
              flexDirection="row"
              gap={10}
              alignItems="flex-start"
              padding={12}
              borderRadius={12}
              borderWidth={1}
              borderColor="$ember"
              backgroundColor="$emberDim"
              accessibilityRole="alert"
            >
              <IconWifiOff size={16} color={color.$ember} strokeWidth={1.75} />
              <Text
                flex={1}
                fontFamily="$body"
                fontSize={12}
                lineHeight={17}
                color="$text2"
              >
                Wi-Fi is off. Turn it on to host nearby. You don’t need to join
                a network.
              </Text>
            </View>
            <View flexDirection="row" gap={8}>
              <View flex={1}>
                <TogetherBtn
                  size="sm"
                  full
                  variant="quiet"
                  onPress={() => p.onOpenSettings?.()}
                >
                  Open Settings
                </TogetherBtn>
              </View>
              <View flex={1}>
                <TogetherBtn
                  size="sm"
                  full
                  variant="soft"
                  onPress={() => p.onRetry?.()}
                >
                  Try again
                </TogetherBtn>
              </View>
            </View>
          </View>
        )}
        {!!p.notice && (
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$warning"
            accessibilityRole="alert"
          >
            {p.notice}
          </Text>
        )}
      </View>
    </BottomSheet>
  );
}
