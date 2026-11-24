import { eq, inArray } from "drizzle-orm";
import { privateMediaPurges, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { deleteAllUserMedia } from "./privateMediaStore";

/**
 * The account purge's private media step (PER-121, design F; Inspector Brad
 * on #553).
 *
 * The purge must never delete a user's photos while the account can still
 * be restored, and must never forget them once it can't. So:
 *
 *   1. Before its SQL purge, the sweep QUEUES the user here (a durable row).
 *   2. `purgeUserData` then deletes the account, or aborts if the user
 *      restored it first (its own `deleted_at` re-check).
 *   3. The drain looks at each queued user's profile:
 *      - gone → the purge happened: delete every object, then the row;
 *      - present and restored (`deleted_at` null) → drop the row, keep the
 *        objects;
 *      - present and still deleted → keep the row (the purge retries).
 *
 * A failed object delete leaves the row, so the next night retries it.
 */

export async function queuePrivateMediaPurge(userId: string): Promise<void> {
  await getDb()
    .insert(privateMediaPurges)
    .values({ userId })
    .onConflictDoNothing();
}

export interface DrainSummary {
  deleted: number;
  restored: number;
  waiting: number;
  failed: number;
}

export async function drainPrivateMediaPurges(
  deleteMedia: (userId: string) => Promise<unknown> = deleteAllUserMedia,
): Promise<DrainSummary> {
  const summary: DrainSummary = {
    deleted: 0,
    restored: 0,
    waiting: 0,
    failed: 0,
  };
  const queued = await getDb()
    .select({ userId: privateMediaPurges.userId })
    .from(privateMediaPurges)
    .orderBy(privateMediaPurges.queuedAt)
    .limit(500);
  if (queued.length === 0) return summary;
  const ids = queued.map((q) => q.userId);
  const existing = await getDb()
    .select({ id: profiles.id, deletedAt: profiles.deletedAt })
    .from(profiles)
    .where(inArray(profiles.id, ids));
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const userId of ids) {
    const profile = byId.get(userId);
    if (profile && profile.deletedAt) {
      summary.waiting += 1;
      continue;
    }
    try {
      if (profile) {
        summary.restored += 1;
      } else {
        await deleteMedia(userId);
        summary.deleted += 1;
      }
      await getDb()
        .delete(privateMediaPurges)
        .where(eq(privateMediaPurges.userId, userId));
    } catch (err) {
      summary.failed += 1;
      console.error(`[private-media-purge] failed for ${userId}:`, err);
    }
  }
  return summary;
}
