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
 * **Bounded** (Inspector Brad, #570 rounds 3–4): the drain shares the purge
 * cron's 300 s Lambda with other sweeps, and Stream calls can be slow or
 * failing. The budget applies to the STREAM step only: chat erasures stop
 * being started once `deadlineMs` of the run has passed, after
 * `maxChatErasures` in one run, or after `maxChatFailures` failures (a
 * Stream outage), and those rows are deferred. The bucket delete always
 * runs. A failed row is moved behind the others by the drain, so rows that
 * keep failing can't starve the queue; deferred rows keep their place.
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
    // PER-121's bucket delete always runs first, with no budget, exactly as
    // before chat existed: it is idempotent, so a row deferred for its Stream
    // step only repeats a cheap no-op next night (Inspector Brad, #570).
    await deleteAllUserMedia(userId);
    if (!getStreamClient()) return "done";
    if (
      clock() >= deadline ||
      started >= maxErasures ||
      failures >= maxFailures
    ) {
      return "deferred";
    }
    started += 1;
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
