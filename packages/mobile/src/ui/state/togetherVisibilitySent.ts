/**
 * Who can join an Online session, as its host last sent it (PER-60).
 *
 * The snapshot doesn't carry visibility, and minimising the workout unmounts
 * the session screen, so the host's choice is kept here, per session, the way
 * `togetherRosterSeen` keeps the roster. It lasts the session. Memory only:
 * after a restart the segment reads Private until the host sends again.
 */

export type TogetherVisibility = { value: "invite-only" | "friends" };

const sent = new Map<string, TogetherVisibility>();

export function rememberVisibilitySent(
  sessionId: string,
  visibility: TogetherVisibility,
) {
  sent.set(sessionId, visibility);
}

/** Forgets a send the server refused, so its own answer shows again. */
export function forgetVisibilitySentFor(sessionId: string) {
  sent.delete(sessionId);
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
