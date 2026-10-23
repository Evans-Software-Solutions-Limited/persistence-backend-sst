import type { ReactNode } from "react";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { IconX, iconDefaults } from "@/ui/components/icons";
import { TogetherPill } from "./TogetherPill";
import {
  NEARBY_CONNECTION_LABEL,
  ONLINE_CONNECTION_LABEL,
} from "./TogetherConnectionChoice";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";

export function togetherInviteLine(
  connection: "local" | "online",
  audience?: TogetherLobbyAudience,
): string {
  const mode =
    connection === "online" ? ONLINE_CONNECTION_LABEL : NEARBY_CONNECTION_LABEL;
  return audience === "invite-only"
    ? `${mode} · only people with this QR`
    : `${mode} · training partners join straight in`;
}

/** Canvas rows 1b/1c "Invite people": the QR is the authenticated invitation; Share sends it. */
export function TogetherInvitePresenter(p: {
  qr: ReactNode;
  connection: "local" | "online";
  audience?: TogetherLobbyAudience;
  notice?: string;
  pendingCount?: number;
  busy?: boolean;
  onShare(): void;
  onClose(): void;
}) {
  return (
    <View gap={14} alignItems="center">
      <View
        alignSelf="stretch"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={22}
          letterSpacing={-0.5}
          color="$text"
        >
          Invite people
        </Text>
        <TogetherPill
          onPress={p.onClose}
          accessibilityLabel="Close"
          icon={<IconX {...iconDefaults({ size: 16 })} />}
        />
      </View>
      <View
        padding={14}
        borderRadius={14}
        backgroundColor="white"
        accessibilityRole="image"
        accessibilityLabel="Session QR code"
      >
        {p.qr}
      </View>
      <Text
        fontFamily="$body"
        fontSize={12}
        lineHeight={17}
        color="$text3"
        textAlign="center"
      >
        {togetherInviteLine(p.connection, p.audience)}
      </Text>
      {!!p.pendingCount && (
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$primary"
          accessibilityLiveRegion="polite"
        >
          {p.pendingCount === 1
            ? "1 person is waiting for you to let them in"
            : `${p.pendingCount} people are waiting for you to let them in`}
        </Text>
      )}
      {!!p.notice && (
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$warning"
          textAlign="center"
          accessibilityLiveRegion="polite"
        >
          {p.notice}
        </Text>
      )}
      <View alignSelf="stretch">
        <Btn
          full
          size="lg"
          variant="soft"
          disabled={p.busy}
          onPress={p.onShare}
        >
          Share code
        </Btn>
      </View>
    </View>
  );
}
