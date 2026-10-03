import type { ReactNode } from "react";
import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
import type {
  TogetherLobbyAudience,
  TogetherLobbySnapshot,
} from "@/domain/ports/togetherLobby.port";

export type TogetherLobbyScreen = "start" | "join";
export interface TogetherLobbyPresenterProps {
  snapshot: TogetherLobbySnapshot;
  screen: TogetherLobbyScreen;
  code: string;
  notice: string;
  workoutName: string;
  audience: TogetherLobbyAudience;
  onAudienceChange(value: TogetherLobbyAudience): void;
  onBrowse(): void;
  onSelectDiscovered(sessionId: string): void;
  onUseInvitation(): void;
  onCodeChange(value: string): void;
  onHost(): void;
  onSelect(): void;
  onJoin(): void;
  onScan(): void;
  onCopy(): void;
  onReconnect(): void;
  onCancel(): void;
  onApprove(peerId: string): void;
  onDecline(peerId: string): void;
  qr?: ReactNode;
  scanner?: ReactNode;
}

const PHASE_COPY: Record<TogetherLobbySnapshot["phase"], string> = {
  disabled: "Together is not available yet.",
  idle: "",
  preparing: "Preparing your secure connection…",
  selected: "Host identity verified. Choose Join to continue.",
  hosting: "Waiting for athletes on your Wi-Fi or hotspot.",
  browsing: "Looking for verified open lobbies on this Wi-Fi or hotspot…",
  searching: "Looking for this host on your Wi-Fi or hotspot…",
  connecting: "Verifying the host connection…",
  "pending-approval": "Waiting for the host to approve your request.",
  joined: "Connected to the lobby. Your workout remains personal.",
  reconnecting: "Connection interrupted. Your personal workout is safe.",
  unavailable: "Together is unavailable. You can keep training on your own.",
  full: "This lobby is full. Four athletes can join, including the host.",
};

export function togetherErrorCopy(code?: string): string {
  if (!code) return "";
  if (code === "discovery-expired")
    return "This lobby listing has expired. Search this network again or ask the host for an invitation. Internet is not required.";
  if (code === "host-unavailable")
    return "This host is no longer available to join. Keep training on your own or choose another lobby.";
  if (/expired/i.test(code))
    return "Your offline access has expired. Connect to the internet to renew it, then try again.";
  if (/offline-unprepared/i.test(code))
    return "Connect to the internet once to prepare Together on this device.";
  if (/unauthorized|ineligible/i.test(code))
    return "Every athlete needs a qualifying paid subscription to train together.";
  if (
    /permission|wifi|lan_unavailable|discovery|advertising|listener/i.test(code)
  )
    return "Check local-network permissions and that both phones are on the same reachable Wi-Fi or hotspot. Internet is not required.";
  if (/timeout|unreachable/i.test(code))
    return "The host could not be reached. Check the host is still here and both phones share the same Wi-Fi or hotspot.";
  if (/invalid|proof|signature|invite/i.test(code))
    return "This invitation could not be verified. Ask the host for a new code or QR.";
  if (/declined/i.test(code))
    return "The host declined this request. Your personal workout is unchanged.";
  if (/key|storage/i.test(code))
    return "Secure access is unavailable on this device. Your personal workout and recovery remain available.";
  return "Could not connect securely. Keep training on your own, or try a new invitation.";
}

function Copy({ children }: { children: ReactNode }) {
  return (
    <Text fontFamily="$body" fontSize={13} lineHeight={20} color="$text2">
      {children}
    </Text>
  );
}

/** Reviewed cards, consent lines and entry layout; connection/error states are approved additions. */
export function TogetherLobbyPresenter(p: TogetherLobbyPresenterProps) {
  const s = p.snapshot;
  const idle = s.phase === "idle";
  const error = togetherErrorCopy(s.error);
  return (
    <View gap={16} testID="together-lobby-content">
      {idle && p.screen === "start" && (
        <>
          <Copy>
            Up to four athletes. Everyone needs a qualifying paid subscription.
            Your logged sets stay yours.
          </Copy>
          <Card
            accent="primary"
            accessibilityRole="radio"
            accessibilityState={{ checked: true }}
          >
            <Text fontFamily="$display" fontSize={15} color="$text">
              Same Wi-Fi / hotspot
            </Text>
            <Copy>Train without internet on the same reachable network.</Copy>
          </Card>
          <View
            gap={10}
            accessibilityRole="radiogroup"
            accessibilityLabel="Who can join?"
          >
            <Text fontFamily="$display" fontSize={15} color="$text">
              Who can join?
            </Text>
            {(
              [
                ["invite-only", "Private", "Code or QR only"],
                [
                  "open",
                  "Open on this network",
                  "Athletes on this Wi-Fi or hotspot can find it",
                ],
              ] as const
            ).map(([value, title, detail]) => (
              <Card
                key={value}
                onPress={() => p.onAudienceChange(value)}
                accessibilityRole="radio"
                accessibilityLabel={title}
                accessibilityState={{ checked: p.audience === value }}
                accent={p.audience === value ? "primary" : undefined}
              >
                <View flexDirection="row" alignItems="center" gap={12}>
                  <Text
                    color={p.audience === value ? "$primary" : "$text3"}
                    fontSize={20}
                  >
                    {p.audience === value ? "◉" : "○"}
                  </Text>
                  <View flex={1}>
                    <Text fontFamily="$display" fontSize={15} color="$text">
                      {title}
                    </Text>
                    <Copy>{detail}</Copy>
                  </View>
                </View>
              </Card>
            ))}
          </View>
          <Copy>
            Accepted training partners join deliberately. Anyone else needs your
            approval. Joining never grants access to history or permission to
            log for someone.
          </Copy>
          <Copy>
            Nearby radio is not available yet. Use the same Wi-Fi or hotspot.
          </Copy>
          <Btn full onPress={p.onHost}>
            Start the session
          </Btn>
        </>
      )}
      {idle && p.screen === "join" && (
        <>
          <Copy>
            Enter the invitation they shared, or scan their QR. Use the same
            Wi-Fi or hotspot.
          </Copy>
          <Card>
            <View gap={12}>
              <Text fontFamily="$body" fontWeight="600" color="$text">
                Session invitation
              </Text>
              <TextInput
                value={p.code}
                onChangeText={p.onCodeChange}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={12000}
                accessibilityLabel="Session invitation"
                testID="together-code"
                placeholder="Paste invitation"
                placeholderTextColor="#8A8A98"
                style={{
                  minHeight: 48,
                  maxHeight: 100,
                  padding: 12,
                  color: "#F4F4F8",
                  backgroundColor: "#181B26",
                  borderRadius: 12,
                  fontFamily: "Geist",
                }}
              />
              <Btn full disabled={!p.code.trim()} onPress={p.onSelect}>
                Continue
              </Btn>
              <Copy>or</Copy>
              <Btn full variant="outline" onPress={p.onScan}>
                Scan a QR code
              </Btn>
            </View>
          </Card>
          <Btn full variant="outline" onPress={p.onBrowse}>
            Find an open lobby on this network
          </Btn>
          {p.scanner}
        </>
      )}
      {s.phase === "browsing" && (
        <View gap={12}>
          <Copy>
            Only open lobbies on this reachable Wi-Fi or hotspot appear here.
            Review a lobby, then choose Join separately.
          </Copy>
          {(s.discovered ?? []).length === 0 && (
            <Card>
              <Copy>
                No verified open lobbies found yet. Private sessions need a code
                or QR.
              </Copy>
            </Card>
          )}
          {s.discovered?.map((lobby) => (
            <Card key={lobby.sessionId}>
              <View gap={8}>
                <Text fontFamily="$display" fontSize={17} color="$text">
                  {lobby.workoutName}
                </Text>
                <Copy>Verified host · {lobby.hostUserId}</Copy>
                <Copy>Athletes · {lobby.memberCount} of 4 at last check</Copy>
                <Copy>
                  Friends join deliberately. Other athletes request approval.
                </Copy>
                <Btn
                  full
                  variant="outline"
                  onPress={() => p.onSelectDiscovered(lobby.sessionId)}
                >
                  View lobby
                </Btn>
              </View>
            </Card>
          ))}
          <Btn full variant="outline" onPress={p.onBrowse}>
            Search again
          </Btn>
          <Btn full variant="ghost" onPress={p.onUseInvitation}>
            Use a code or QR instead
          </Btn>
        </View>
      )}
      {s.role === "host" && s.audience && (
        <Copy>
          {s.audience === "invite-only"
            ? "Private · code or QR only"
            : "Open · discoverable on this Wi-Fi or hotspot"}
        </Copy>
      )}
      {s.selection && (
        <Card>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={17}
            color="$text"
          >
            {s.selection.workoutName}
          </Text>
          <Copy>Verified host · {s.selection.hostUserId}</Copy>
        </Card>
      )}
      {s.phase === "selected" && (
        <>
          <Card>
            <View gap={12}>
              <Text
                fontFamily="$display"
                fontSize={10}
                letterSpacing={2}
                color="$text3"
              >
                IF YOU JOIN
              </Text>
              <Copy>
                ✓ You join this host’s lobby with your verified account.
              </Copy>
              <Copy>✓ Everyone logs their own weights and reps.</Copy>
              <Copy>
                ✓ Your personal workout stays available if the connection stops.
              </Copy>
              <Copy>
                ✓ Joining does not share your history, weight, food or coaching.
              </Copy>
              <Copy>
                ✓ Nobody can log sets for you without separate permission.
              </Copy>
            </View>
          </Card>
          <Btn full onPress={p.onJoin}>
            Join the lobby
          </Btn>
        </>
      )}
      {s.phase !== "idle" && (
        <View accessibilityLiveRegion="polite">
          <Copy>{PHASE_COPY[s.phase]}</Copy>
        </View>
      )}
      {error && (
        <Text
          fontFamily="$body"
          fontSize={13}
          lineHeight={20}
          color="$warning"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      )}
      {s.invitation && s.role === "host" && (
        <Card>
          <View gap={12} alignItems="center">
            {p.qr}
            <Copy>Share this invitation with the athletes joining you.</Copy>
            <Btn full variant="outline" onPress={p.onCopy}>
              Copy invitation
            </Btn>
          </View>
        </Card>
      )}
      {s.members.length > 0 && (
        <Card>
          <View gap={8}>
            <Text fontFamily="$display" fontSize={15} color="$text">
              Athletes · {s.members.length} of 4
            </Text>
            {s.members.map((m) => (
              <Copy key={m.userId}>
                {m.host ? "Host" : "Athlete"} · {m.userId}
              </Copy>
            ))}
          </View>
        </Card>
      )}
      {s.pending.map((request) => (
        <Card key={request.peerId}>
          <View gap={10}>
            <Text fontFamily="$display" fontSize={15} color="$text">
              Join request
            </Text>
            <Copy>Verified account · {request.userId}</Copy>
            <Copy>
              Approval admits this athlete. It does not share PREV or allow them
              to log for you.
            </Copy>
            <Btn full onPress={() => p.onApprove(request.peerId)}>
              Approve
            </Btn>
            <Btn
              full
              variant="outline"
              onPress={() => p.onDecline(request.peerId)}
            >
              Decline
            </Btn>
          </View>
        </Card>
      ))}
      {s.phase === "reconnecting" && (
        <Btn full onPress={p.onReconnect}>
          Reconnect
        </Btn>
      )}
      {p.notice !== "" && <Copy>{p.notice}</Copy>}
      <Btn full variant="ghost" onPress={p.onCancel}>
        {s.phase === "hosting" || s.phase === "joined"
          ? "Leave lobby · keep my workout"
          : "Cancel · keep training on my own"}
      </Btn>
    </View>
  );
}
