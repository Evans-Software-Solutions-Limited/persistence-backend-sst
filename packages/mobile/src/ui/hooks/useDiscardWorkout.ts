import { useRef, useEffect } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { discardTogetherSession } from "@/application/commands/session/discard-together-session.command";
import { cancelSessionCommand } from "@/application/commands/session";
import { useAdapters } from "./useAdapters";
import { useActiveWorkout } from "@/state/active-workout";

/** Every exit binds its confirmation to this account and workout, never a newer draft. */
export function useDiscardWorkout(
  userId: string | null | undefined,
  localSessionId?: string,
) {
  const { storage, togetherLobby, togetherCloud } = useAdapters();
  const owner = useRef({ userId, localSessionId });
  owner.current = { userId, localSessionId };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => {
    if (
      !mounted.current ||
      owner.current.userId !== userId ||
      owner.current.localSessionId !== localSessionId
    )
      return;
    const expected = owner.current;
    if (!expected.userId || !expected.localSessionId) return;
    Alert.alert(
      "Discard workout?",
      "End this workout without rating or saving it. Other athletes keep their own work.",
      [
        { text: "Keep workout", style: "cancel" },
        {
          text: "Discard workout",
          style: "destructive",
          onPress: () => {
            if (
              !mounted.current ||
              owner.current.userId !== expected.userId ||
              owner.current.localSessionId !== expected.localSessionId
            )
              return;
            const own = storage.getActiveSession(expected.userId!);
            if (!own || own.id !== expected.localSessionId) return;
            try {
              if (own.together) {
                discardTogetherSession({
                  storage,
                  userId: own.userId,
                  localSessionId: own.id,
                  workout: togetherLobby?.workout,
                  cloud: togetherCloud,
                });
                if (own.together.transport !== "cloud") {
                  const live = togetherLobby?.getSnapshot();
                  if (live?.members.some((m) => m.userId === own.userId)) {
                    const channel = togetherLobby?.shared;
                    void channel
                      ?.close(live.role === "host" ? "save_own" : "leave")
                      .catch(() => {})
                      .then(() => {
                        if (
                          live.sessionId &&
                          togetherLobby?.getSnapshot().sessionId ===
                            live.sessionId
                        )
                          return togetherLobby.cancel();
                      })
                      .catch(() => {});
                  }
                }
              } else {
                const result = cancelSessionCommand(
                  { storage, userId: own.userId },
                  {},
                );
                if (!result.ok) throw new Error("discard-unavailable");
              }
              if (useActiveWorkout.getState().active?.sessionId === own.id)
                void useActiveWorkout.getState().end();
              router.dismissAll();
            } catch {
              Alert.alert(
                "Workout kept on this device",
                "Could not discard the workout. Please try again.",
              );
            }
          },
        },
      ],
    );
  };
}
