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
import {
  TogetherHubPresenter,
  type TogetherHubPartner,
} from "@/ui/presenters/TogetherHubPresenter";
import type { TogetherLobbySnapshot } from "@/domain/ports/togetherLobby.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
import type { TogetherSocialApi } from "@/domain/ports/togetherSocial.port";
const EMPTY: TogetherLobbySnapshot = {
  phase: "disabled",
  members: [],
  pending: [],
};
export interface PartnerOnlineSession {
  sessionId: string;
  hostUserId: string;
  occupancy: number;
}
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
/** "July" for a partnership accepted this year, "July 2025" otherwise; undefined when unknown. */
export function partnersSince(
  acceptedAt: string | undefined,
  now = new Date(),
): string | undefined {
  if (!acceptedAt) return undefined;
  const date = new Date(acceptedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const month = date.toLocaleDateString("en-GB", { month: "long" });
  return date.getFullYear() === now.getFullYear()
    ? month
    : `${month} ${date.getFullYear()}`;
}
/** Accepted partners by id, every page, for the hub card and the join rows. */
export async function loadPartners(
  social: TogetherSocialApi,
  userId: string,
): Promise<TogetherHubPartner[]> {
  const partners: TogetherHubPartner[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await social.friends(cursor);
    if (!result.ok) throw result.error;
    for (const r of result.value.data) {
      if (r.status !== "accepted") continue;
      partners.push({
        userId: r.userId === userId ? r.friendId : r.userId,
        name: r.person?.displayName?.trim() || "Training partner",
        since: partnersSince(r.updatedAt),
      });
    }
    if (!result.value.nextCursor) break;
    cursor = result.value.nextCursor;
  }
  return partners;
}

/** Canvas row 1 hub: Start, Join and partners' Online sessions. Nearby discovery lives in Join. */
export function TogetherHubContainer() {
  const {
    api,
    togetherLobby: lobby,
    togetherCloud: cloud,
    storage,
  } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId;
  const gate = useTogetherGate();
  const state = useSyncExternalStore(
    (l) => lobby?.subscribe(l) ?? (() => {}),
    () => lobby?.getSnapshot() ?? EMPTY,
  );
  const active = userId ? storage.getActiveSession(userId) : null;
  const [partners, setPartners] = useState<TogetherHubPartner[]>([]);
  const [partnersError, setPartnersError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const focused = useRef(false);
  const owner = useRef({ userId, cloud });
  owner.current = { userId, cloud };
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setPartners((current) => (current.length ? [] : current));
    setPartnersError("");
  }, [userId]);
  const live =
    ["hosting", "joined", "reconnecting"].includes(state.phase) ||
    !!active?.together ||
    !!cloud?.getSnapshot().snapshot;
  const reload = useCallback(
    (pull = false) => {
      const social = api.togetherSocial;
      if (!social || !userId || !gate.allowed) return;
      const scope = ++generation.current;
      const expected = { userId, cloud };
      const current = () =>
        scope === generation.current &&
        owner.current.userId === expected.userId &&
        owner.current.cloud === expected.cloud;
      if (pull) setRefreshing(true);
      void (async () => {
        const [list, sessions] = await Promise.all([
          loadPartners(social, userId),
          cloud ? loadPartnerSessions(cloud).catch(() => []) : [],
        ]);
        if (!current()) return;
        setPartners(
          list.map((partner) => {
            const session = sessions.find(
              (s) => s.hostUserId === partner.userId,
            );
            return session
              ? {
                  ...partner,
                  live: {
                    sessionId: session.sessionId,
                    occupancy: session.occupancy,
                  },
                }
              : partner;
          }),
        );
        setPartnersError("");
      })()
        .catch(() => {
          if (current())
            setPartnersError(
              "Could not refresh training partners. Connect to the internet and try again.",
            );
        })
        .finally(() => {
          if (current()) setRefreshing(false);
        });
    },
    [api.togetherSocial, cloud, userId, gate.allowed],
  );
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
    <TogetherHubPresenter
      accessState={gate.state}
      onUpgrade={gate.onUpgrade}
      onRetry={gate.retry}
      activeWorkout={live}
      onResume={() => router.push("/(app)/session" as never)}
      onStart={() => router.push("/(app)/together/start" as never)}
      onJoin={() => router.push("/(app)/together/join" as never)}
      partners={partners}
      partnersError={partnersError}
      refreshing={refreshing}
      onRefresh={() => reload(true)}
      onPartner={() => router.push("/(app)/together/partners" as never)}
      onJoinOnline={(sessionId) => {
        if (live || !focused.current || owner.current.userId !== userId) return;
        router.push({
          pathname: "/(app)/together/join",
          params: { session: sessionId, connection: "online" },
        } as never);
      }}
    />
  );
}
