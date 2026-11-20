/**
 * The BE-H1 seam (PER-113) for the You page, History and Recap.
 *
 * The phone works the page out from its own training log (offline-first,
 * backend design H). The log only holds workouts finished on this phone
 * since it started keeping one (`StoragePort.getTrainingLogSince`). Older
 * months, the 3-month Recap and a new phone need the server:
 *
 *   GET /users/me/history?month=YYYY-MM | ?date=YYYY-MM-DD
 *   GET /users/me/recap?period=week|month|3months
 *   GET /users/me/muscle-volume?days=7
 *
 * Those routes don't exist yet, so every source here answers
 * `unavailable`. When BE-H1 merges: add the three calls to `ApiPort`,
 * implement `YouRemoteSource` over them (caching responses by period), and
 * pass it to the containers in place of `youRemoteUnavailable`. Every
 * container (You, History, Recap) already asks `needsRemote` before
 * trusting a range to the phone and calls the seam when it's true; BE-H1
 * only has to use the answers. Y1 has no coverage note on the canvas, so
 * until then a part-kept week simply shows what the phone holds (Brad,
 * 20 Nov: start empty, no backfill).
 */

import type { RecapPeriod } from "@/domain/services/youPage";

export type YouRemoteResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" };

/** Server reads for ranges the phone's training log doesn't cover. */
export interface YouRemoteSource {
  /** Day keys with anything logged in a month (`YYYY-MM`). */
  historyMonth(month: string): Promise<YouRemoteResult<readonly string[]>>;
  /** A recap the phone can't build on its own. */
  recap(period: RecapPeriod): Promise<YouRemoteResult<unknown>>;
  /** Y1's last 7 days (`GET /users/me/muscle-volume?days=7`). */
  lastSevenDays(): Promise<YouRemoteResult<unknown>>;
}

/** Until BE-H1 (PER-113) ships: the server can't fill any gap yet. */
export const youRemoteUnavailable: YouRemoteSource = {
  historyMonth: async () => ({ status: "unavailable" }),
  recap: async () => ({ status: "unavailable" }),
  lastSevenDays: async () => ({ status: "unavailable" }),
};

/**
 * True when a range starts before the phone began keeping its training
 * log, so the phone alone can't answer it in full. No log yet (`since`
 * null) means nothing is on the phone.
 */
export function needsRemote(since: string | null, from: Date): boolean {
  if (since == null) return true;
  return from.getTime() < Date.parse(since);
}
