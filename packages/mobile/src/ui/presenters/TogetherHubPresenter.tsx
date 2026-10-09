import { Text, View } from "@tamagui/core";
import { Btn, Card } from "@/ui/components/foundation";

/** Inline hub body sharing its scroll and refresh with the partner list. */
export function TogetherHubPresenter(p: {
  accessState: "pending" | "allowed" | "locked" | "unavailable";
  onUpgrade(): void;
  onRetry(): void;
  onWorkouts(): void;
  onPartners?(): void;
  onJoin?(): void;
  onScan?(): void;
  sessions?: readonly {
    sessionId: string;
    workoutName: string;
    memberCount: number;
  }[];
  discovering?: boolean;
  error?: string;
  onSelect?(id: string): void;
  activeWorkout?: boolean;
  onResume?(): void;
}) {
  return (
    <View gap={16} testID="together-hub-content">
      {p.accessState !== "allowed" ? (
        <Card testID="together-access-gate">
          <View gap={12}>
            <Text fontFamily="$display" fontSize={20} color="$text">
              Train together
            </Text>
            <Text color="$text2" fontFamily="$body">
              {p.accessState === "locked"
                ? "Every athlete needs a qualifying paid subscription."
                : p.accessState === "pending"
                  ? "Checking your Together access…"
                  : "We couldn’t verify your Together access. Your personal workout remains available."}
            </Text>
            {p.accessState === "locked" ? (
              <>
                <Btn onPress={p.onUpgrade}>View subscriptions</Btn>
                <Btn variant="ghost" onPress={p.onRetry}>
                  Check access again
                </Btn>
              </>
            ) : p.accessState === "unavailable" ? (
              <Btn onPress={p.onRetry}>Retry access check</Btn>
            ) : null}
          </View>
        </Card>
      ) : (
        <>
          <View gap={6}>
            <Text fontFamily="$display" fontSize={20} color="$text">
              Workouts to join
            </Text>
            <Text color="$text2" fontFamily="$body" fontSize={13}>
              Open sessions on the same Wi-Fi or hotspot. Everyone keeps their
              own sets.
            </Text>
          </View>
          {!!p.error && (
            <Text color="$warning" accessibilityRole="alert">
              {p.error}
            </Text>
          )}
          {p.activeWorkout ? (
            <Card>
              <View gap={10}>
                <Text color="$text2">
                  Your Together workout is already active.
                </Text>
                <Btn onPress={() => p.onResume?.()}>Back to my workout</Btn>
              </View>
            </Card>
          ) : (
            <>
              {!p.sessions?.length && (
                <Card>
                  <Text color="$text2" fontFamily="$body">
                    {p.discovering
                      ? "Looking for open sessions…"
                      : "No open sessions found. Join the host’s Wi-Fi or hotspot, or use an invitation."}
                  </Text>
                </Card>
              )}
              {p.sessions?.map((s) => (
                <Card key={s.sessionId}>
                  <View gap={12}>
                    <Text color="$text" fontFamily="$display" fontSize={17}>
                      {s.workoutName}
                    </Text>
                    <Text color="$text2">
                      Verified host · {s.memberCount} of 4 athletes
                    </Text>
                    <Btn
                      full
                      variant="outline"
                      onPress={() => p.onSelect?.(s.sessionId)}
                    >
                      View and join
                    </Btn>
                  </View>
                </Card>
              ))}
              <View flexDirection="row" gap={10}>
                <View flex={1}>
                  <Btn full variant="outline" onPress={() => p.onJoin?.()}>
                    Join a session
                  </Btn>
                </View>
                <View flex={1}>
                  <Btn full variant="outline" onPress={() => p.onScan?.()}>
                    Scan invitation
                  </Btn>
                </View>
              </View>
            </>
          )}
          <Card surface={1}>
            <View gap={10}>
              <Text fontFamily="$display" fontSize={17} color="$text">
                Want to start your own?
              </Text>
              <Text color="$text2" fontSize={13}>
                Choose a workout, decide who can join, then start sharing.
              </Text>
              <Btn variant="soft" onPress={p.onWorkouts}>
                Choose a workout
              </Btn>
            </View>
          </Card>
        </>
      )}
    </View>
  );
}
