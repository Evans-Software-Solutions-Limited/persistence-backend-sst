import { useCallback, useEffect, useRef } from "react";
import { router, useFocusEffect } from "expo-router";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { TogetherLobbyPort } from "@/domain/ports/togetherLobby.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";

/** Each phone rates its own workout when the host ends for everyone. */
export function useTogetherEndNavigation(
  userId: string | null,
  storage: StoragePort,
  lobby?: TogetherLobbyPort,
  cloud?: TogetherCloudPort,
) {
  const focused = useRef(false);
  const recheck = useRef<(() => void) | null>(null);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      recheck.current?.();
      return () => {
        focused.current = false;
      };
    }, []),
  );
  const routed = useRef<string | null>(null);
  useEffect(() => {
    routed.current = null;
    if (!userId) return;
    const check = () => {
      if (!focused.current) return;
      const own = storage.getLatestSession(userId);
      if (!own?.together || routed.current === own.id) return;
      const ended =
        own.together.transport === "cloud"
          ? (() => {
              const s = cloud?.getSnapshot().snapshot;
              return (
                s?.sessionId === own.together.sessionId &&
                s.state === "closed" &&
                s.participants.some(
                  (p) =>
                    p.userId === userId &&
                    (p.status === "saved" || p.status === "finished_empty"),
                )
              );
            })()
          : lobby?.shared
              ?.getSnapshot()
              .closures.some(
                (c) => c.mode === "finish_all" && c.userId !== userId,
              );
      if (!ended) return;
      routed.current = own.id;
      router.push({
        pathname: "/(app)/session/rate",
        params: { localSessionId: own.id },
      } as never);
    };
    recheck.current = check;
    let shared = lobby?.shared;
    let local = shared?.subscribe(check);
    const lobbyChanges = lobby?.subscribe?.(() => {
      if (shared !== lobby.shared) {
        local?.();
        shared = lobby.shared;
        local = shared?.subscribe(check);
      }
      check();
    });
    const remote = cloud?.subscribe(check);
    check();
    return () => {
      recheck.current = null;
      local?.();
      lobbyChanges?.();
      remote?.();
    };
  }, [userId, storage, lobby, cloud]);
}
