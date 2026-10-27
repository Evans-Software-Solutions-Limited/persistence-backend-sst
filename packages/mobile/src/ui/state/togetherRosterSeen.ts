/**
 * The last Online roster seen while sharing was live (PER-60).
 *
 * Once sharing stops, the server's snapshot lists only the caller, so a
 * guest who rates after the host's Finish for all, or who carries on solo
 * after End, would otherwise lose the summary's Trained together page. The
 * Online container records the roster while it's live; the rating screen
 * reads it back for the same session. Memory only: after a restart the page
 * is simply left out.
 */

import type { CloudSnapshot } from "@/domain/ports/togetherCloud.port";

type Seen = {
  sessionId: string;
  participants: { userId: string; displayName?: string | null }[];
};

let seen: Seen | null = null;

/** Keeps the roster of a snapshot that has someone else in it. */
export function rememberCloudRoster(snapshot: CloudSnapshot | undefined) {
  if (!snapshot || snapshot.participants.length < 2) return;
  seen = {
    sessionId: snapshot.sessionId,
    participants: snapshot.participants.map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
    })),
  };
}

/** The roster last seen for this session, or `null`. */
export function cloudRosterSeen(
  sessionId: string,
): Seen["participants"] | null {
  return seen?.sessionId === sessionId ? seen.participants : null;
}

/** Test seam. */
export function forgetCloudRoster() {
  seen = null;
}
