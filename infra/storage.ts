import { webDomain } from "./domains";

// Public-read S3 bucket for user profile avatars. Path layout: `<userId>/avatar.jpg`.
// Public access matches the legacy Supabase Storage `avatars` bucket — avatars are
// surfaced anywhere a profile is visible (friends, trainers, public profiles), so
// the URLs need to be embeddable without signing.
//
// CORS is permissive for GET/HEAD only — uploads always go via the API Lambda
// (signed via Supabase JWT), never direct from the browser/mobile, so we don't
// need to whitelist PUT origins.
export const avatarsBucket = new sst.aws.Bucket("Avatars", {
  access: "public",
  cors: {
    allowMethods: ["GET", "HEAD"],
    allowOrigins: ["*"],
    allowHeaders: ["*"],
    maxAge: "1 day",
  },
});

// ─── CoachPrivateMedia (PER-121, backend design F) ──────────────────────────
// PRIVATE bucket for progress photos, form photo answers and coach resource
// files. Key layout (built only by the core API, never by a client):
//   progress/<userId>/<setId>/<pose>.jpg
//   forms/<userId>/<mediaId>.jpg
//   resources/<trainerId>/<mediaId>/file.<ext>
//   pending/<any of the above>   ← where presigned uploads land
//
// - No public access: `access` is unset, so SST's BucketPublicAccessBlock
//   blocks every public ACL and policy, and `enforceHttps` (SST default true)
//   denies plain-HTTP requests.
// - Phones and the coach web upload straight to S3 with presigned PUTs to
//   `pending/<key>`, pinned to the key, Content-Type and Content-Length
//   (`application/media/privateMediaStore.ts`). The API's complete checks the
//   staged object with HeadObject and copies it to the final key. No client
//   link can write a final key, so a late or replayed PUT only lands in
//   `pending/`.
// - Views are presigned GETs minted per request after the access check: 15
//   minutes for the owner, 5 for a coach. Nothing here is ever public.
// - CORS is only for the coach web (browsers); the native app sends no Origin.
// - Lifecycle: anything still under `pending/` (an upload never completed, or
//   a late duplicate) is deleted after 1 day.
const privateMediaOrigins = webDomain
  ? [`https://${webDomain}`]
  : // Personal / dev stages: the local Vite dev server.
    ["http://localhost:5173"];

export const coachPrivateMediaBucket = new sst.aws.Bucket("CoachPrivateMedia", {
  cors: {
    allowMethods: ["GET", "HEAD", "PUT"],
    allowOrigins: privateMediaOrigins,
    allowHeaders: ["content-type"],
    maxAge: "1 hour",
  },
  lifecycle: [
    {
      id: "expire-uncompleted-uploads",
      prefix: "pending/",
      expiresIn: "1 day",
    },
  ],
});

// Explicit server-side encryption (SSE-S3, AES-256) rather than relying on
// the account default, so the setting is visible in code and in review.
new aws.s3.BucketServerSideEncryptionConfigurationV2(
  "CoachPrivateMediaEncryption",
  {
    bucket: coachPrivateMediaBucket.name,
    rules: [
      {
        applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" },
        bucketKeyEnabled: true,
      },
    ],
  },
);
