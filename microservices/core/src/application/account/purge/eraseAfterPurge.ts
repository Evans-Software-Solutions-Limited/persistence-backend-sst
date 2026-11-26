import { deleteAllUserMedia } from "../../media/privateMediaStore";
import {
  eraseChatUser,
  getStreamClient,
  StreamDeletePendingError,
} from "../../chat/chatChannels";

/**
 * What the nightly drain erases outside the database for an account whose
 * purge has COMMITTED (its profile is gone). Both steps are irreversible, so
 * they only ever run here, never before `purgeUserData` (Inspector Brad on
 * #553 and #570):
 *
 *  - PER-121: every private bucket object of the user;
 *  - PER-120: the user's Stream chat presence (removed from and freezing
 *    their `coaching` channels, then the Stream user and messages
 *    hard-deleted).
 *
 * It rides the existing durable queue: the sweep queues every account in
 * `private_media_purges` BEFORE its SQL purge, and `drainPrivateMediaPurges`
 * calls this only once the profile is gone, drops the row (touching nothing)
 * for a restored account, and keeps the row when this throws or returns
 * `"deferred"`, so a later night finishes it (each step is idempotent). No
 * new queue table.
 *
 * **Bounded** (Inspector Brad, #570 round 3): the drain shares the purge
 * cron's 300 s Lambda with other sweeps, and Stream calls can be slow or
 * failing. Chat erasures stop being started once `deadlineMs` of the run has
 * passed, after `maxChatErasures` in one run, or after `maxChatFailures`
 * failures (a Stream outage), and the remaining rows are deferred untouched.
 * Without Stream keys the row is bucket-only, exactly as before.
 */

export interface EraseAfterPurgeOptions {
  /** When the cron run started (the deadline counts from here). */
  startedAt: Date;
  deadlineMs?: number;
  maxChatErasures?: number;
  maxChatFailures?: number;
  clock?: () => number;
}

export const ERASE_DEADLINE_MS = 120_000;
export const MAX_CHAT_ERASURES_PER_RUN = 20;
export const MAX_CHAT_FAILURES_PER_RUN = 2;

export type EraseOutcome = "done" | "deferred";

export function eraseAfterPurge(
  options: EraseAfterPurgeOptions,
): (userId: string) => Promise<EraseOutcome> {
  const deadline =
    options.startedAt.getTime() + (options.deadlineMs ?? ERASE_DEADLINE_MS);
  const maxErasures = options.maxChatErasures ?? MAX_CHAT_ERASURES_PER_RUN;
  const maxFailures = options.maxChatFailures ?? MAX_CHAT_FAILURES_PER_RUN;
  const clock = options.clock ?? Date.now;
  let started = 0;
  let failures = 0;

  return async (userId) => {
    if (!getStreamClient()) {
      await deleteAllUserMedia(userId);
      return "done";
    }
    if (
      clock() >= deadline ||
      started >= maxErasures ||
      failures >= maxFailures
    ) {
      return "deferred";
    }
    started += 1;
    await deleteAllUserMedia(userId);
    try {
      await eraseChatUser(userId);
    } catch (err) {
      if (err instanceof StreamDeletePendingError) return "deferred";
      failures += 1;
      throw err;
    }
    return "done";
  };
}
