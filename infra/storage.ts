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
