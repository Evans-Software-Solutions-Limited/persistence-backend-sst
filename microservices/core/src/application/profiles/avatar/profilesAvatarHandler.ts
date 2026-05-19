import Elysia, { t } from "elysia";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Resource } from "sst";
import { ProfileService } from "../../repositories/profileService";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const AVATAR_KEY = "avatar.jpg";

// SST's auto-generated `sst-env.d.ts` declares the Resource interface but
// only refreshes after `sst dev` / `sst deploy` runs against the updated
// infra. Until the next deploy regenerates types, this cast keeps `tsc
// --noEmit` green; at runtime Lambda receives the bucket binding from
// `infra/api.ts` regardless.
const AvatarsResource = (
  Resource as Resource & {
    Avatars: { name: string };
  }
).Avatars;

// Module-level singleton — instantiated once per Lambda cold start, reused
// across warm invocations. The SDK manages its own connection pool, so a
// per-request client would waste TCP/TLS work on every upload.
const s3Client = new S3Client({});

function publicAvatarUrl(userId: string): string {
  const bucket = AvatarsResource.name;
  const region = process.env.AWS_REGION ?? "eu-west-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${userId}/${AVATAR_KEY}`;
}

export const profilesAvatarHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProfileService)
  .post(
    "/profile/avatar",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const file = ctx.body.file;

      const mimeType = file.type.toLowerCase();
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        ctx.set.status = 400;
        return {
          error: "Unsupported content type. Expected image/jpeg|png|webp.",
        };
      }

      if (file.size > MAX_AVATAR_BYTES) {
        ctx.set.status = 400;
        return { error: "Avatar exceeds 5MB limit." };
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const key = `${userId}/${AVATAR_KEY}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: AvatarsResource.name,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          // CacheControl matches the cache-buster strategy on mobile:
          // the URL is stable per-user, so we tell CDN/clients to revalidate
          // each fetch. Mobile additionally appends `?_cb=<n>` after upload
          // to force re-render past in-memory caches.
          CacheControl: "no-cache, max-age=0",
        }),
      );

      const avatarUrl = publicAvatarUrl(userId);
      const profile = await ctx.ProfileRepository.update(userId, {
        avatarUrl,
      });

      if (!profile) {
        ctx.set.status = 404;
        return { error: "Profile not found" };
      }

      return { data: { avatarUrl } };
    },
    {
      body: t.Object({
        file: t.File(),
      }),
    },
  )
  .delete("/profile/avatar", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    // S3 DELETE is idempotent — succeeds whether the object exists or not.
    // We tolerate failures here because the DB nullification is the source
    // of truth from the user's perspective: a stranded object is harmless
    // (overwritten by next upload) but a stuck DB row leaves a broken URL
    // in the UI.
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: AvatarsResource.name,
          Key: `${userId}/${AVATAR_KEY}`,
        }),
      );
    } catch (err) {
      console.warn(
        `[profile:avatar:delete] S3 delete failed for ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const profile = await ctx.ProfileRepository.update(userId, {
      avatarUrl: null,
    });

    if (!profile) {
      ctx.set.status = 404;
      return { error: "Profile not found" };
    }

    return { data: { avatarUrl: null } };
  });
