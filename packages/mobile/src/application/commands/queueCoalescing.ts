import type { SyncQueueEntry } from "@/domain/ports/storage.port";

/**
 * May this queued entry's body be rewritten in place (edit coalescing), or must
 * the caller enqueue a separate follow-up mutation instead?
 *
 * Coalescing an edit into a queued CREATE reuses that create's `idempotencyKey`
 * with a different body. If the original POST already reached the server — and we
 * cannot know that it didn't once the request has left the device — the replay
 * hits the server's `ON CONFLICT (created_by, client_request_id) DO NOTHING` and
 * gets back the row the FIRST attempt created. The drain sees a 2xx, marks the
 * entry completed and swaps the id, so the local cache shows the edited name while
 * the server still holds the original. The next full refresh overwrites the cache
 * and the user's edit is gone, with no error surfaced anywhere.
 *
 * That is strictly worse than what it replaced: before idempotency keys existed
 * the same sequence produced a DUPLICATE row, which is visible and fixable. Silent
 * loss of an edit is neither.
 *
 * So: a create may only be rewritten while it has provably never been sent.
 * `dispatchCount` is the only signal that can answer this, because it is the only
 * one no reset path clears — `retryCount` and `deferCount` are both zeroed by
 * `resetFailedEntries`, and a user tapping Retry does not un-send what was already
 * sent.
 *
 * Two deliberate exemptions:
 * - `permanently_failed` — a permanent 4xx is the server explicitly REJECTING the
 *   request, so nothing was committed and there is no row for a replay to collide
 *   with. Rewriting is not just safe but valuable: the edit may be the very thing
 *   that fixes the rejection, which is why `update-exercise` resets and re-queues.
 * - non-creates — an UPDATE or DELETE is naturally idempotent against a real id;
 *   replaying one with a newer body is exactly the intended outcome.
 *
 * Refusing to coalesce is never lossy: the caller enqueues a follow-up PATCH
 * against the (possibly still local) id instead, and `swapLocal*Id` re-points it
 * when the create's reply lands. One extra round trip, correct result.
 */
export function canRewriteWithoutReplayingKey(entry: SyncQueueEntry): boolean {
  if (entry.operation !== "create") return true;
  if (entry.status === "permanently_failed") return true;
  return entry.dispatchCount === 0;
}
