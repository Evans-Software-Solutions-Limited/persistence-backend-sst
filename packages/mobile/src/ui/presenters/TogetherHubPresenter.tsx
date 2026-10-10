import { Pressable } from "react-native";
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
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Text fontFamily="$display" fontSize={20} color="$text">
              Sessions
            </Text>
            {!p.activeWorkout && (
              <Btn size="sm" variant="ghost" onPress={() => p.onJoin?.()}>
                Join a session
              </Btn>
            )}
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
                <Text color="$text2" fontFamily="$body" fontSize={13}>
                  No workouts available to you
                </Text>
              )}
              {p.sessions?.map((session) => (
                <Pressable
                  key={session.sessionId}
                  accessibilityRole="button"
                  accessibilityLabel={`Join ${session.workoutName}`}
                  onPress={() => p.onSelect?.(session.sessionId)}
                >
                  <View
                    flexDirection="row"
                    alignItems="center"
                    paddingVertical={14}
                    borderBottomWidth={1}
                    borderColor="$border"
                  >
                    <View flex={1} gap={4} alignItems="flex-start">
                      <Text color="$text" fontFamily="$display" fontSize={17}>
                        {session.workoutName}
                      </Text>
                      <Text color="$text2" fontFamily="$body" fontSize={12}>
                        {session.memberCount} / 4 athletes
                      </Text>
                    </View>
                    <Text color="$text3" fontSize={22}>
                      ›
                    </Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            paddingVertical={12}
            borderTopWidth={p.sessions?.length ? 0 : 1}
            borderBottomWidth={1}
            borderColor="$border"
          >
            <Text fontFamily="$display" fontSize={17} color="$text">
              Start a workout
            </Text>
            <Btn size="sm" variant="ghost" onPress={p.onWorkouts}>
              Choose workout
            </Btn>
          </View>
        </>
      )}
    </View>
  );
}
