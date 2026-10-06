import type { ReactNode } from "react";
import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
import { TogetherAudienceOptions } from "./TogetherAudienceOptions";
import type {
  TogetherLobbyAudience,
  TogetherLobbySnapshot,
} from "@/domain/ports/togetherLobby.port";
import type { TogetherWorkoutStatus } from "@/domain/ports/togetherWorkout.port";

export type TogetherLobbyScreen = "start" | "join";
export interface TogetherLobbyPresenterProps {
  snapshot: TogetherLobbySnapshot;
  screen: TogetherLobbyScreen;
  code: string;
  notice: string;
  workoutName: string;
  audience: TogetherLobbyAudience;
  trainingPartners?: { selected: boolean; onSelect(): void };
  workoutStatus?: TogetherWorkoutStatus | null;
  onPromote?(): void;
  onReview?(): void;
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
  connectionOptions?: ReactNode;
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

export function togetherErrorCopy(
  code?: string,
  transport?: TogetherLobbySnapshot["transport"],
): string {
  const nearby = transport === "nearby",
    owner = transport === "hotspot-owner";
  if (!code) return "";
  if (code === "removed-from-session")
    return "You were removed from this session. Your own workout remains on this device for personal logging and review.";
  if (code === "discovery-expired")
    return nearby
      ? "This nearby lobby listing has expired. Search nearby again or ask the host for an invitation. Internet is not required."
      : owner
        ? "This lobby listing has expired. Search this Android phone’s hotspot again or ask the host for an invitation. Internet is not required."
        : "This lobby listing has expired. Search this network again or ask the host for an invitation. Internet is not required.";
  if (code === "friendship-required")
    return "Only accepted training partners can join this session. Connect online to refresh your friendship, then try again.";
  if (code === "host-unavailable")
    return "This host is no longer available to join. Keep training on your own or choose another lobby.";
  if (/expired/i.test(code))
    return "Your offline access has expired. Connect to the internet to renew it, then try again.";
  if (/offline-unprepared/i.test(code))
    return "Connect to the internet once to prepare Together on this device.";
  if (code === "paid-required" || code === "PAID_REQUIRED")
    return "Every athlete needs a qualifying paid subscription to train together.";
  if (code === "authentication-required" || code === "signed-out")
    return "Sign in again to prepare Together. Your personal workout remains on this device.";
  if (code === "service-unavailable")
    return "Together access is unavailable for this account or app environment. Try again later. Your personal workout is safe.";
  if (code === "device-revoked")
    return "Together access for this device was revoked. Contact support to restore device access. You can keep training on your own.";
  if (code === "registration-conflict")
    return "Together could not register this device securely. Contact support if this continues. Your personal workout is safe.";
  if (code === "registration-invalid")
    return "Together could not verify this device. Check that your phone’s date and time are automatic, then try again.";
  if (/unauthorized|ineligible/i.test(code))
    return "Together access could not be authorized. Connect to the internet and try again. Your personal workout is safe.";
  if (
    /permission|wifi|lan_unavailable|discovery|advertising|listener/i.test(code)
  )
    if (nearby)
      return "Check Bluetooth and nearby-device permissions on both phones, and keep them within reach. Internet is not required.";
    else if (owner)
      return "Check local-network permissions, turn on this Android phone’s hotspot and connect the other phones to it. Hotspot discovery may be unavailable on this device; internet is not required.";
    else
      return "Check local-network permissions and that both phones are on the same reachable Wi-Fi or hotspot. Internet is not required.";
  if (/timeout|unreachable/i.test(code))
    return nearby
      ? "The host could not be reached. Keep both phones nearby with Bluetooth and nearby-device permissions enabled."
      : owner
        ? "The host could not be reached. Check this Android phone’s hotspot is still on and the other phone is connected to it."
        : "The host could not be reached. Check the host is still here and both phones share the same Wi-Fi or hotspot.";
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

export function togetherWorkoutCopy(
  sharing: TogetherWorkoutStatus["sharing"],
): string {
  return {
    active: "Saved on this device",
    reconnecting: "Reconnecting · saved locally",
    "local-only": "Saved locally · sharing ended",
    paused: "Saved locally · sharing paused",
  }[sharing];
}

/** Reviewed cards, consent lines and entry layout; connection/error states are approved additions. */
export function TogetherLobbyPresenter(p: TogetherLobbyPresenterProps) {
  const s = p.snapshot;
  const idle = s.phase === "idle" && !p.workoutStatus;
  const nearby = s.transport === "nearby",
    owner = s.transport === "hotspot-owner";
  const place = nearby
    ? "nearby"
    : owner
      ? "on this Android phone’s hotspot"
      : "on this Wi-Fi or hotspot";
  const error = togetherErrorCopy(s.error, s.transport);
  const phaseCopy = nearby
    ? {
        ...PHASE_COPY,
        hosting: "Waiting for nearby athletes.",
        browsing: "Looking for verified nearby open lobbies…",
        searching: "Looking for this host nearby…",
      }
    : owner
      ? {
          ...PHASE_COPY,
          hosting:
            "Waiting for athletes connected to this Android phone’s hotspot.",
          browsing:
            "Looking for verified open lobbies on this Android phone’s hotspot…",
          searching: "Looking for this host on this Android phone’s hotspot…",
        }
      : PHASE_COPY;
  return (
    <View gap={16} testID="together-lobby-content">
      {p.workoutStatus ? (
        <Card accent="primary">
          <View gap={10} accessibilityLiveRegion="polite">
            <Text fontFamily="$display" fontSize={17} color="$text">
              My workout
            </Text>
            <Copy>{togetherWorkoutCopy(p.workoutStatus.sharing)}</Copy>
            <Copy>
              Your complete workout journal is retained on this device. Private
              shared views have separate delivery receipts.
            </Copy>
            {p.workoutStatus.sharing === "paused" && (
              <Copy>
                Your workout changed beyond what can be shared here. Keep
                logging on this device; sharing stays paused.
              </Copy>
            )}
            {p.workoutStatus.sharing === "local-only" && (
              <Copy>
                Your workout is restored on this device. This does not rejoin or
                reopen the lobby.
              </Copy>
            )}
            <Copy>
              Your workout stays on this device until you review and save your
              result. A peer receipt does not mean your result is saved to your
              account.
            </Copy>
            {p.onReview && (
              <Btn full variant="outline" onPress={p.onReview}>
                Review my result
              </Btn>
            )}
          </View>
        </Card>
      ) : p.onPromote && (s.phase === "hosting" || s.phase === "joined") ? (
        <Card accent="primary">
          <View gap={12}>
            <Text fontFamily="$display" fontSize={17} color="$text">
              Keep your logged sets
            </Text>
            <Copy>
              Use your current workout. Choose who can see your weights and reps
              in Together settings. Your exercises and logged sets stay in
              place. This does not share PREV or let anyone log for you.
            </Copy>
            <Copy>
              Your workout is kept on this device. When you finish, review your
              own result before saving it to your account.
            </Copy>
            <Btn full onPress={p.onPromote}>
              Use my workout in Together
            </Btn>
          </View>
        </Card>
      ) : null}
      {idle && p.screen === "start" && (
        <>
          <Copy>
            Up to four athletes. Everyone needs a qualifying paid subscription.
            Your logged sets stay yours.
          </Copy>
          <TogetherAudienceOptions
            trainingPartners={p.trainingPartners}
            audience={p.audience}
            onAudienceChange={p.onAudienceChange}
            transport={s.transport}
          />
          <Copy>
            Local Training partners sessions require verified friendship. In
            other sessions, accepted partners join deliberately and anyone else
            needs your approval. Joining never grants access to history or
            permission to log for someone.
          </Copy>

          {owner && (
            <Copy>
              Turn on your Android hotspot and connect the other phones to it.
              Discovery depends on device support.
            </Copy>
          )}
          {p.connectionOptions}
          <Btn full onPress={p.onHost}>
            Start the session
          </Btn>
          <Btn full variant="outline" onPress={p.onUseInvitation}>
            Join
          </Btn>
        </>
      )}
      {idle && p.screen === "join" && p.connectionOptions}
      {idle && p.screen === "join" && (
        <>
          <Copy>
            {nearby
              ? "Enter the invitation they shared, or scan their QR. Keep both phones nearby."
              : owner
                ? "Enter the invitation they shared, or scan their QR. Connect the other phones to this Android phone’s hotspot."
                : "Enter the invitation they shared, or scan their QR. Use the same Wi-Fi or hotspot."}
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
            {nearby
              ? "Find an open lobby nearby"
              : "Find an open lobby on this network"}
          </Btn>
          {p.scanner}
        </>
      )}
      {s.phase === "browsing" && (
        <View gap={12}>
          <Copy>
            {nearby
              ? "Only reachable nearby open lobbies appear here. Review a lobby, then choose Join separately."
              : owner
                ? "Only open lobbies reachable through this Android phone’s hotspot appear here. Review a lobby, then choose Join separately."
                : "Only open lobbies on this reachable Wi-Fi or hotspot appear here. Review a lobby, then choose Join separately."}
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
          {s.audience === "friends"
            ? "Training partners only · share the code or QR"
            : s.audience === "invite-only"
              ? "Private · code or QR only"
              : `Open · discoverable ${place}`}
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
          <Copy>
            {s.phase === "joined" && p.workoutStatus
              ? "Connected to the lobby. Everyone logs their own workout."
              : phaseCopy[s.phase]}
          </Copy>
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
