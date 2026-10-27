import { useEffect, useReducer, useRef } from "react";
import { applyNearbyConsent } from "@/application/together/nearbyConsent";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
import type { TogetherLobbyPort } from "@/domain/ports/togetherLobby.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import {
  cloudSharingBase,
  cloudSharingWrites,
  nearbySharingBase,
  nearbySharingWrites,
  sharingPeople,
} from "@/ui/presenters/togetherSharing";
import {
  useTogetherSharing,
  type TogetherSharingSource,
} from "./useTogetherSharing";

const LIVE = ["hosting", "joined", "reconnecting"];

/** "Your session" for the host, else "Brad’s session". */
export function sessionTitle(
  userId: string,
  hostId: string | null | undefined,
  hostName: string | null | undefined,
) {
  if (hostId === userId) return "Your session";
  return hostName ? `${hostName}’s session` : "The host’s session";
}

/**
 * Together settings' live card (canvas row 4, phone 4): the session running
 * now, read from the adapters, so it works while the workout is minimised.
 * Writes go to the session, never to the defaults. Null when nothing is live.
 */
export function useLiveTogetherSharing(p: {
  userId: string | null;
  lobby?: TogetherLobbyPort;
  cloud?: TogetherCloudPort;
  storage: Pick<StoragePort, "getActiveSession" | "getPreviousForTogether">;
}) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const shared = p.lobby?.shared;
  useEffect(() => p.lobby?.subscribe(refresh), [p.lobby]);
  useEffect(() => shared?.subscribe(refresh), [shared]);
  useEffect(() => p.cloud?.subscribe(refresh), [p.cloud]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  let title = "";
  let source: TogetherSharingSource | null = null;
  const userId = p.userId;
  const lobby = p.lobby?.getSnapshot();
  const sharedSnapshot = shared?.getSnapshot();
  const cloud = p.cloud?.getSnapshot().snapshot;
  if (
    userId &&
    shared &&
    sharedSnapshot &&
    lobby?.sessionId &&
    LIVE.includes(lobby.phase) &&
    !sharedSnapshot.closures.some(
      (c) =>
        c.userId === userId ||
        lobby.members.some((m) => m.host && m.userId === c.userId),
    )
  ) {
    const people = sharingPeople(
      lobby.members,
      userId,
      (id, seat) => sharedSnapshot.profiles[id] ?? `Athlete ${seat + 1}`,
    );
    const host = lobby.members.find((m) => m.host);
    title = sessionTitle(
      userId,
      host?.userId,
      host && sharedSnapshot.profiles[host.userId],
    );
    source = {
      sessionId: lobby.sessionId,
      people,
      base: nearbySharingBase(sharedSnapshot.grants, userId, people),
      write: async (target) => {
        const workout = () => p.storage.getActiveSession(userId);
        await Promise.all(
          nearbySharingWrites(
            shared.getSnapshot().grants,
            userId,
            people,
            target,
          ).map((w) =>
            applyNearbyConsent({
              shared,
              accountId: userId,
              recipient: w.recipientId,
              consent: w.consent,
              stillCurrent: () => mounted.current && p.lobby?.shared === shared,
              getWorkout: workout,
              getPrevious: () => {
                const current = workout();
                if (!current) return [];
                return (
                  p.storage.getPreviousForTogether?.(
                    userId,
                    current.exercises
                      .filter((e) => !e.skipped)
                      .map((e) => e.exerciseId),
                    current.startedAt,
                  ) ?? []
                ).map((row) => ({
                  ...row,
                  recordedAt: Date.parse(row.recordedAt),
                }));
              },
            }),
          ),
        );
      },
    };
  } else if (userId && cloud?.sharingActive) {
    const own = cloud.participants.find((x) => x.userId === userId);
    if (own) {
      const people = sharingPeople(
        cloud.participants,
        userId,
        (id, seat) =>
          cloud.participants.find((x) => x.userId === id)?.displayName ??
          `Athlete ${seat + 1}`,
      );
      title = sessionTitle(
        userId,
        cloud.hostId,
        cloud.participants.find((x) => x.userId === cloud.hostId)?.displayName,
      );
      const cloudPort = p.cloud!;
      source = {
        sessionId: cloud.sessionId,
        people,
        base: cloudSharingBase(own, people),
        write: async (target) => {
          const w = cloudSharingWrites(own, people, target);
          await Promise.all([
            ...(w.numbers ? [cloudPort.numbersConsent(w.numbers)] : []),
            ...(w.previous ? [cloudPort.previousConsent(w.previous)] : []),
            ...(w.logging !== undefined
              ? [cloudPort.delegation(w.logging)]
              : []),
          ]);
        },
      };
    }
  }
  const sharing = useTogetherSharing(source);
  return sharing.state
    ? { title, state: sharing.state, onChange: sharing.change }
    : null;
}
