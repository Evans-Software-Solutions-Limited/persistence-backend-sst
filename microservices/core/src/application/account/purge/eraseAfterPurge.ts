import { deleteAllUserMedia } from "../../media/privateMediaStore";
import { eraseChatUser } from "../../chat/chatChannels";

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
 * for a restored account, and keeps the row when this throws, so the next
 * night retries both steps (each is idempotent). No new queue table.
 */
export async function eraseAfterPurge(userId: string): Promise<void> {
  await deleteAllUserMedia(userId);
  await eraseChatUser(userId);
}
