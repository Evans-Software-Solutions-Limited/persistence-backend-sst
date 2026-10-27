/**
 * The last Together roster seen while sharing was live (PER-60).
 *
 * Once sharing stops, neither transport still knows who trained: Online's
 * snapshot lists only the caller, and Nearby's Leave or End cancels the lobby,
 * which empties its seats. A guest who rates after the host's Finish for all,
 * or anyone who carries on solo after Leave or End, would otherwise lose the
 * summary's Trained together page. The live containers record the roster; the
 * rating screen reads it back for the same session. Memory only: after a
 * restart the page is simply left out.
 */

import type { CloudSnapshot } from "@/domain/ports/togetherCloud.port";

type Person = { userId: string; displayName?: string | null };
type Seen = { sessionId: string; participants: Person[] };

let seen: Seen | null = null;

function remember(sessionId: string, participants: Person[]) {
  if (participants.length < 2) return;
  seen = { sessionId, participants };
}

/** Keeps the roster of an Online snapshot that has someone else in it. */
export function rememberCloudRoster(snapshot: CloudSnapshot | undefined) {
  if (!snapshot) return;
  remember(
    snapshot.sessionId,
    snapshot.participants.map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
    })),
  );
}

/** Keeps the Nearby seats, in seat order, with the names published so far. */
export function rememberNearbyRoster(
  sessionId: string | undefined,
  members: readonly { userId: string }[],
  profiles: Readonly<Record<string, string>> = {},
) {
  if (!sessionId) return;
  remember(
    sessionId,
    members.map((m) => ({
      userId: m.userId,
      displayName: profiles[m.userId] ?? null,
    })),
  );
}

/** The roster last seen for this session, or `null`. */
export function rosterSeen(sessionId: string): Seen["participants"] | null {
  return seen?.sessionId === sessionId ? seen.participants : null;
}

/** Test seam. */
export function forgetRoster() {
  seen = null;
}
