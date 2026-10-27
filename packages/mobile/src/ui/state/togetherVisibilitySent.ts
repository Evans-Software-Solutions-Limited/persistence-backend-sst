/**
 * Who can join an Online session, as its host last sent it (PER-60).
 *
 * The snapshot doesn't carry visibility, and minimising the workout unmounts
 * the session screen, so the host's choice is kept here, per session, the way
 * `togetherRosterSeen` keeps the roster. Partners lapses after the server's
 * 15 minutes. Memory only: after a restart the segment reads Private until the
 * host sends again.
 */

export type TogetherVisibility = {
  value: "invite-only" | "friends";
  /** When the server stops listing the session to partners; null for Private. */
  until: number | null;
};

const sent = new Map<string, TogetherVisibility>();

export function rememberVisibilitySent(
  sessionId: string,
  visibility: TogetherVisibility,
) {
  sent.set(sessionId, visibility);
}

/** What was last sent for this session, or null. */
export function visibilitySent(
  sessionId: string | undefined,
): TogetherVisibility | null {
  return (sessionId && sent.get(sessionId)) || null;
}

/** Test seam. */
export function forgetVisibilitySent() {
  sent.clear();
}
