/**
 * Which partners' apps share empty rows (PER-60, #523).
 *
 * A partner on this app shares every row, logged or not, and the partner view
 * then mirrors those rows exactly; an older app shares logged sets only, so
 * the view adds planned stand-ins. Only the newer app ever sends a row that
 * isn't completed, and it does so from admission, so once one is seen the
 * partner is known for the rest of the session, even after they log every
 * row they have. Memory only, keyed by session; the containers record every
 * render.
 */

import type { TogetherSharedSnapshot } from "@/domain/ports/togetherShared.port";

let seen: { sessionId: string; owners: Set<string> } | null = null;

/** Notes every partner whose projection carries an empty (not completed) row. */
export function rememberEmptyRows(
  sessionId: string | undefined,
  snapshot: Pick<TogetherSharedSnapshot, "athletes"> | undefined,
) {
  if (!sessionId || !snapshot) return;
  if (seen?.sessionId !== sessionId) seen = { sessionId, owners: new Set() };
  for (const athlete of snapshot.athletes)
    if (
      Object.values(athlete.exercises).some((e) =>
        e.sets.some((set) => !set.completed),
      )
    )
      seen.owners.add(athlete.userId);
}

/** Whether this partner has been seen sharing empty rows in this session. */
export function sharesEmptyRows(
  sessionId: string | undefined,
  ownerId: string,
): boolean {
  return (
    !!sessionId && seen?.sessionId === sessionId && seen.owners.has(ownerId)
  );
}

/** Tests only. */
export function resetEmptyRowsSeen() {
  seen = null;
}
