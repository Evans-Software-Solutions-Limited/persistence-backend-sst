import type { ReactNode } from "react";
import { Text, View } from "@tamagui/core";
import { TogetherBtn } from "./TogetherBtn";
import { IconX, iconDefaults } from "@/ui/components/icons";
import { TogetherPill } from "./TogetherPill";
import {
  NEARBY_CONNECTION_LABEL,
  ONLINE_CONNECTION_LABEL,
} from "./TogetherConnectionChoice";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";
import { formatSessionCode } from "@/adapters/together/planDetails";
import { color } from "@/ui/theme/tokens";

/**
 * Canvas rows 1b/1c `.qr`: a 200pt code in a 14pt white box. The box is the
 * quiet zone, so the code itself adds none. Both invite sheets pass this to
 * `TogetherInvitationQr`; its width-based default (304pt plus a 28pt quiet
 * zone) made the sheet scroll.
 */
export const TOGETHER_INVITE_QR = { size: 200, quietZone: 0 } as const;

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
  /** The six-character session code, read aloud or typed on Join a session. */
  code?: string;
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
          lineHeight={28}
          letterSpacing={-0.5}
          color="$text"
        >
          Invite people
        </Text>
        <TogetherPill
          onPress={p.onClose}
          accessibilityLabel="Close"
          icon={
            // Canvas `.pill` colour. Without it the icon is `currentColor`,
            // which react-native-svg draws black on the dark pill.
            <IconX {...iconDefaults({ size: 16 })} color={color.$text2} />
          }
        />
      </View>
      <View
        padding={14}
        borderRadius={14}
        backgroundColor="white"
        overflow="hidden"
        accessibilityRole="image"
        accessibilityLabel="Session QR code"
      >
        {p.qr}
      </View>
      {!!p.code && (
        <Text
          fontFamily="$mono"
          fontWeight="600"
          fontSize={28}
          lineHeight={36}
          letterSpacing={3}
          color="$text"
          textAlign="center"
          accessibilityLabel={`Session code ${p.code.split("").join(" ")}`}
          testID="together-session-code"
        >
          {formatSessionCode(p.code)}
        </Text>
      )}
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
          lineHeight={17}
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
          lineHeight={17}
          color="$warning"
          textAlign="center"
          accessibilityLiveRegion="polite"
        >
          {p.notice}
        </Text>
      )}
      <View alignSelf="stretch">
        <TogetherBtn variant="soft" disabled={p.busy} onPress={p.onShare}>
          Share code
        </TogetherBtn>
      </View>
    </View>
  );
}
