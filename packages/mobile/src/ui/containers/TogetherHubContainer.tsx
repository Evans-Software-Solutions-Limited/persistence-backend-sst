import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { router, useFocusEffect } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useTogetherGate } from "@/ui/hooks/useTogetherGate";
import { useAuth } from "@/ui/hooks/useAuth";
import { TogetherHubPresenter } from "@/ui/presenters/TogetherHubPresenter";
import type { PartnerOnlineSession } from "@/ui/presenters/TogetherPartnersPresenter";
import { TogetherPartnersContainer } from "./TogetherPartnersContainer";
import type { TogetherLobbySnapshot } from "@/domain/ports/togetherLobby.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
const EMPTY: TogetherLobbySnapshot = {
  phase: "disabled",
  members: [],
  pending: [],
};
/** Bounded page walk of partners' Online sessions; never presents the first page as the whole list. */
export async function loadPartnerSessions(
  cloud: TogetherCloudPort,
): Promise<PartnerOnlineSession[]> {
  const sessions: PartnerOnlineSession[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await cloud.friends(cursor);
    if (!result.ok) throw result.error;
    for (const f of result.value.data)
      sessions.push({
        sessionId: f.sessionId,
        hostUserId: f.host.userId,
        occupancy: f.occupancy,
      });
    if (!result.value.nextCursor) break;
    cursor = result.value.nextCursor;
  }
  return sessions;
}

/** Canvas row 1 hub: Start, Join and partners' Online sessions. Nearby discovery lives in Join. */
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
  const [onlineSessions, setOnlineSessions] = useState<PartnerOnlineSession[]>(
    [],
  );
  const focused = useRef(false);
  const owner = useRef({ userId, cloud });
  owner.current = { userId, cloud };
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setOnlineSessions((current) => (current.length ? [] : current));
  }, [userId]);
  const live =
    ["hosting", "joined", "reconnecting"].includes(state.phase) ||
    !!active?.together ||
    !!cloud?.getSnapshot().snapshot;
  const reload = useCallback(() => {
    if (!cloud || !userId || !gate.allowed) return;
    const scope = ++generation.current;
    const expected = { userId, cloud };
    void loadPartnerSessions(cloud)
      .then((sessions) => {
        if (
          scope === generation.current &&
          owner.current.userId === expected.userId &&
          owner.current.cloud === expected.cloud
        )
          setOnlineSessions(sessions);
      })
      .catch(() => {
        // Partners' sessions are a convenience; the partner list reports its own load errors.
      });
  }, [cloud, userId, gate.allowed]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      reload();
      return () => {
        focused.current = false;
      };
    }, [reload]),
  );
  return (
    <TogetherPartnersContainer
      embedded
      onRefresh={reload}
      onlineSessions={live ? [] : onlineSessions}
      onJoinOnline={(sessionId) => {
        if (live || !focused.current || owner.current.userId !== userId) return;
        router.push({
          pathname: "/(app)/together/join",
          params: { session: sessionId, connection: "online" },
        } as never);
      }}
      header={
        <TogetherHubPresenter
          accessState={gate.state}
          onUpgrade={gate.onUpgrade}
          onRetry={gate.retry}
          activeWorkout={live}
          onResume={() => router.push("/(app)/session" as never)}
          onStart={() => router.push("/(app)/together/start" as never)}
          onJoin={() => router.push("/(app)/together/join" as never)}
        />
      }
    />
  );
}
