import { TextInput } from "react-native";
import { Text, View, useTheme } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
import type { TogetherCloudState } from "@/domain/ports/togetherCloud.port";
/** Known server states get actionable product copy; unknown backend strings stay private. */
export function togetherCloudErrorCopy(error?: string): string | null {
  if (!error) return null;
  const code = error.toLowerCase().replaceAll("_", "-");
  if (code === "session-full" || code === "full")
    return "All four places are occupied. A place becomes available when an athlete leaves or the host removes them.";
  if (/ineligible|entitlement|subscription|paid-required/.test(code))
    return "Every athlete needs a qualifying paid subscription. You can keep logging your own workout.";
  if (code === "invalid-schema")
    return "This workout could not be shared in its current format. Continue personally to keep and finish your logged work.";
  if (/pending-approval|join-pending|approval-required/.test(code))
    return "Waiting for host approval. Your personal workout remains available.";
  if (/rejected|declined/.test(code))
    return "The host declined your request. Keep training on your own or ask for another session.";
  if (/removed/.test(code))
    return "You were removed from this session. Your own workout remains available for logging, review and saving.";
  if (/network|timeout|offline/.test(code))
    return "Remote sharing needs internet. Reconnect to check delivery; your changes remain on this device and personal logging is available.";
  if (/conflict|stale/.test(code))
    return "The session changed. Refresh and review the latest state before trying again. Your own workout remains on this device.";
  if (/unauthorized|cloud-account/.test(code))
    return "Sign in to the account that owns this workout to reconnect. Your local workout is retained.";
  if (/forbidden|permission/.test(code))
    return "This sharing action is no longer authorized. Refresh the session to check current permission; your own workout remains available.";
  if (/expired|invalid-invite/.test(code))
    return "This invitation is unavailable or expired. Ask the host for a new invitation.";
  if (/not-found|join-unavailable|closed/.test(code))
    return "This session is no longer available to join. Your own workout remains available.";
  return null;
}
export function TogetherCloudPresenter(p: {
  state: TogetherCloudState;
  accountId: string;
  workoutName: string;
  code: string;
  busy: boolean;
  notice: string;
  invitation?: string;
  friends: readonly {
    sessionId: string;
    hostName: string;
    occupancy: number;
  }[];
  onCode(value: string): void;
  onHost(): void;
  onJoin(): void;
  onFriends(): void;
  onSelectFriend(id: string): void;
  onInvite(): void;
  onRevoke(): void;
  onDecision(id: string, approve: boolean): void;
  onRetry(): void;
  onReview(): void;
  onCancel(): void;
  onLocal(): void;
  onPartners(): void;
  onVisible(): void;
}) {
  const theme = useTheme();
  const s = p.state.snapshot;
  const hosting = s?.hostId === p.accountId;
  const error =
    togetherCloudErrorCopy(p.state.error) ||
    p.notice ||
    (p.state.error
      ? "Could not confirm remote sharing. Retry the connection; your personal workout remains available."
      : "");
  return (
    <View gap={16}>
      <Text fontFamily="$display" color="$text" fontSize={24}>
        Train together
      </Text>
      <Text color="$text2">
        Remote · training partners. Every athlete needs a qualifying paid
        subscription. Internet is required for this connection.
      </Text>
      {!!error && (
        <Text accessibilityLiveRegion="polite" color="$error">
          {error}
        </Text>
      )}
      {!s && p.state.phase !== "pending-approval" && (
        <>
          <Card>
            <View gap={10}>
              <Text fontFamily="$display" color="$text">
                {p.workoutName}
              </Text>
              <Text color="$text2">
                Start with your own workout and keep independent results for up
                to four athletes.
              </Text>
              <Btn full disabled={p.busy} onPress={p.onHost}>
                Start remote session
              </Btn>
            </View>
          </Card>
          <TextInput
            accessibilityLabel="Remote invitation"
            value={p.code}
            onChangeText={p.onCode}
            autoCapitalize="none"
            style={{
              color: theme.text?.val,
              backgroundColor: theme.surface2?.val,
              borderWidth: 1,
              borderColor: theme.border?.val,
              padding: 12,
              borderRadius: 10,
            }}
          />
          <Btn
            full
            variant="outline"
            disabled={p.busy || !p.code.trim()}
            onPress={p.onJoin}
          >
            Join deliberately
          </Btn>
          <Btn full variant="soft" disabled={p.busy} onPress={p.onFriends}>
            Find training partners’ sessions
          </Btn>
          {p.friends.map((f) => (
            <Card key={f.sessionId}>
              <View gap={8}>
                <Text color="$text">
                  {f.hostName} · {f.occupancy}/4 athletes
                </Text>
                <Btn
                  disabled={p.busy || f.occupancy >= 4}
                  onPress={() => p.onSelectFriend(f.sessionId)}
                >
                  Join {f.hostName}
                </Btn>
              </View>
            </Card>
          ))}
          <Btn full variant="ghost" onPress={p.onLocal}>
            Use nearby or Wi-Fi instead
          </Btn>
        </>
      )}
      {p.state.phase === "pending-approval" && (
        <Text color="$text2">
          Waiting for host approval. Your personal workout is safe.
        </Text>
      )}
      {p.state.phase === "preparing" && (
        <Text color="$text2">Preparing your session…</Text>
      )}
      {s && (
        <>
          <Text color="$text" fontFamily="$display">
            {s.plan.name} · {s.participants.length}/4 athletes
          </Text>
          <Text color="$text2">
            {p.state.phase === "reconnecting"
              ? "Reconnecting · your changes are kept on this device"
              : s.sharingActive
                ? "Connected · each athlete owns their result"
                : "Sharing ended · your own workout remains available"}
          </Text>
          <Text color="$text2">
            Changes awaiting server acknowledgement: {p.state.pendingCount}
          </Text>
          {hosting && s.sharingActive && (
            <>
              <Btn
                full
                variant="outline"
                disabled={p.busy}
                onPress={p.onInvite}
              >
                Copy invitation
              </Btn>
              {p.invitation && (
                <Btn
                  full
                  variant="ghost"
                  disabled={p.busy}
                  onPress={p.onRevoke}
                >
                  Revoke this invitation
                </Btn>
              )}
              <Btn
                full
                variant="outline"
                disabled={p.busy}
                onPress={p.onVisible}
              >
                Show to training partners for 15 minutes
              </Btn>
            </>
          )}
          {hosting &&
            s.sharingActive &&
            p.state.requests.map((r) => (
              <Card key={r.requestId}>
                <View gap={8}>
                  <Text color="$text">
                    {r.displayName ?? "Athlete"} wants to join
                  </Text>
                  <Btn
                    disabled={p.busy || s.participants.length >= 4}
                    onPress={() => p.onDecision(r.requestId, true)}
                  >
                    Approve
                  </Btn>
                  <Btn
                    variant="ghost"
                    disabled={p.busy}
                    onPress={() => p.onDecision(r.requestId, false)}
                  >
                    Decline
                  </Btn>
                </View>
              </Card>
            ))}
          <Btn full variant="soft" onPress={p.onReview}>
            Review my result
          </Btn>
        </>
      )}
      <Btn full variant="outline" disabled={p.busy} onPress={p.onRetry}>
        Retry connection
      </Btn>
      <Btn full variant="ghost" onPress={p.onPartners}>
        Training partners
      </Btn>
      {!s && (
        <Btn full variant="ghost" onPress={p.onCancel}>
          Cancel · keep my workout
        </Btn>
      )}
    </View>
  );
}
