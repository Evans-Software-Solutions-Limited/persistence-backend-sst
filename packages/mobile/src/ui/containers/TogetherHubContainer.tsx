import { useCallback, useRef, useSyncExternalStore } from "react";
import { router, useFocusEffect } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useTogetherGate } from "@/ui/hooks/useTogetherGate";
import { useAuth } from "@/ui/hooks/useAuth";
import { TogetherHubPresenter } from "@/ui/presenters/TogetherHubPresenter";
import { togetherErrorCopy } from "@/ui/presenters/TogetherLobbyPresenter";
import { TogetherPartnersContainer } from "./TogetherPartnersContainer";
import type { TogetherLobbySnapshot } from "@/domain/ports/togetherLobby.port";
const EMPTY: TogetherLobbySnapshot = {
  phase: "disabled",
  members: [],
  pending: [],
};

/** Verified discovery cannot replace an active session. */
export function TogetherHubContainer() {
  const { togetherLobby: lobby, togetherCloud: cloud, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId;
  const gate = useTogetherGate();
  const state = useSyncExternalStore(
    (l) => lobby?.subscribe(l) ?? (() => {}),
    () => lobby?.getSnapshot() ?? EMPTY,
  );
  const active = userId ? storage.getActiveSession(userId) : null;
  const focused = useRef(false);
  const owner = useRef(userId);
  owner.current = userId;
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  const live =
    ["hosting", "joined", "reconnecting"].includes(state.phase) ||
    !!active?.together ||
    !!cloud?.getSnapshot().snapshot;
  return (
    <TogetherPartnersContainer
      embedded
      header={
        <TogetherHubPresenter
          accessState={gate.state}
          onUpgrade={gate.onUpgrade}
          onRetry={gate.retry}
          sessions={state.discovered}
          error={togetherErrorCopy(state.error, state.transport)}
          activeWorkout={live}
          onResume={() => router.push("/(app)/session" as never)}
          onWorkouts={() => router.push("/(app)/together/start" as never)}
          onJoin={() => router.push("/(app)/together/join" as never)}
          onSelect={(id) => {
            if (
              !lobby ||
              live ||
              !focused.current ||
              owner.current !== userId ||
              (userId && storage.getActiveSession(userId)?.together)
            )
              return;
            void lobby
              .selectDiscovered(id)
              .then(() => {
                if (
                  focused.current &&
                  owner.current === userId &&
                  lobby.getSnapshot().phase === "selected"
                )
                  router.push("/(app)/together/join" as never);
              })
              .catch(() => {});
          }}
        />
      }
    />
  );
}
