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
//
// - No public access: `access` is unset, so SST's BucketPublicAccessBlock
//   blocks every public ACL and policy, and `enforceHttps` (SST default true)
//   denies plain-HTTP requests.
// - Phones and the coach web upload straight to S3 with presigned PUTs pinned
//   to the key, Content-Type, Content-Length and the `upload=pending` tag
//   (`application/media/privateMediaStore.ts`), then call the API's complete,
//   which checks the object with HeadObject and re-tags it `upload=complete`.
// - Views are presigned GETs minted per request after the access check: 15
//   minutes for the owner, 5 for a coach. Nothing here is ever public.
// - CORS is only for the coach web (browsers); the native app sends no Origin.
//   PUT needs `x-amz-tagging` and `content-type` allowed.
// - Lifecycle: an upload that was never completed still carries
//   `upload=pending` and is deleted after 1 day. SST's `lifecycle` only
//   filters by prefix, so the transform swaps the filter for the tag.
const privateMediaOrigins = webDomain
  ? [`https://${webDomain}`]
  : // Personal / dev stages: the local Vite dev server.
    ["http://localhost:5173"];

export const coachPrivateMediaBucket = new sst.aws.Bucket("CoachPrivateMedia", {
  cors: {
    allowMethods: ["GET", "HEAD", "PUT"],
    allowOrigins: privateMediaOrigins,
    allowHeaders: ["content-type", "x-amz-tagging"],
    maxAge: "1 hour",
  },
  lifecycle: [
    {
      id: "expire-uncompleted-uploads",
      expiresIn: "1 day",
    },
  ],
  transform: {
    lifecycle: (args) => {
      args.rules = [
        {
          id: "expire-uncompleted-uploads",
          status: "Enabled",
          expiration: { days: 1 },
          filter: { tag: { key: "upload", value: "pending" } },
        },
      ];
    },
  },
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
