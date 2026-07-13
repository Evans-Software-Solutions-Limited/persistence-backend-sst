import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";

/**
 * Best-effort S3 avatar cleanup for a purged account (Cluster 2a Part B).
 *
 * Mirrors `profilesAvatarHandler.ts`'s `DELETE /profile/avatar` key pattern
 * (`<userId>/avatar.jpg`, public `Avatars` bucket) — same key, same bucket,
 * same "log and continue" failure posture: an orphaned avatar object is
 * harmless (nothing points at it once the profile row is gone) but must
 * never block the purge worker from finishing the rest of the batch.
 *
 * Called AFTER `accountRepository.purgeUserData` + the auth-user delete in
 * the nightly purge worker — the SQL purge + auth removal are the
 * compliance-critical steps; the S3 object is cleanup, not data the user can
 * still be identified by once `profiles`/`auth.users` are gone.
 */

const AVATAR_KEY = "avatar.jpg";

// SST's auto-generated `sst-env.d.ts` only refreshes after `sst dev` / `sst
// deploy` runs against updated infra. Until the next deploy regenerates
// types, this cast keeps `tsc --noEmit` green — mirrors
// `profilesAvatarHandler.ts`'s identical cast.
const AvatarsResource = (
  Resource as Resource & {
    Avatars: { name: string };
  }
).Avatars;

// Module-level singleton, reused across warm Lambda invocations — same
// rationale as `profilesAvatarHandler.ts`'s client.
const s3Client = new S3Client({});

export async function deleteUserAvatar(userId: string): Promise<void> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: AvatarsResource.name,
        Key: `${userId}/${AVATAR_KEY}`,
      }),
    );
  } catch (err) {
    console.warn(
      `[account-purge:avatar] S3 delete failed for ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
