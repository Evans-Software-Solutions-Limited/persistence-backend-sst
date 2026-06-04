# 16 — Exercise Media Upload: Design

> Authored 2026-06-03. Implements `requirements.md`.

---

## Architecture overview

```
Mobile (04.3 sheet / 04.6 editor)
  └─ photo/video box → expo-image-picker (image | video)
       └─ ExercisesApiPort.getMediaUploadUrl({ kind, contentType })
            └─ POST /exercises/media/upload-url (Supabase JWT)
                 └─ exercisesMediaUploadHandler → createPresignedPost(...)
                      → { uploadUrl, fields, publicUrl, key }
       └─ expo-file-system uploadAsync (MULTIPART) → S3 (direct, presigned POST)
       └─ set form.photoUrl | form.videoUrl = publicUrl
  └─ Save → createExerciseCommand / update → thumbnailUrl | videoUrl persisted
            (existing columns + handlers; no migration)
```

The Lambda only signs; bytes go device → S3 directly. Size is capped by the
presigned POST's `content-length-range` condition, so an oversize file is
rejected by S3 without ever touching the Lambda.

---

## Infra

`infra/storage.ts` — new bucket beside `avatarsBucket`:

```ts
export const exerciseMediaBucket = new sst.aws.Bucket("ExerciseMedia", {
  access: "public",
  cors: {
    allowMethods: ["GET", "HEAD", "PUT", "POST"], // POST for presigned-post uploads
    allowOrigins: ["*"],
    allowHeaders: ["*"],
    maxAge: "1 day",
  },
});
```

`infra/api.ts` — add `exerciseMediaBucket` to the API `link: [...]` (so the handler can read `Resource.ExerciseMedia.name` + sign with the bucket's perms, same as `Avatars`).

---

## Backend — `exercises/media/exercisesMediaUploadHandler.ts`

Authed Elysia route, modelled on `profilesAvatarHandler` but signing instead of streaming.

```ts
import Elysia, { t } from "elysia";
import { Resource } from "sst";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";

const LIMITS = {
  image: {
    max: 5 * 1024 * 1024,
    types: new Set(["image/jpeg", "image/png", "image/webp"]),
    ext: extFromImageType,
  },
  video: {
    max: 100 * 1024 * 1024,
    types: new Set(["video/mp4", "video/quicktime"]),
    ext: extFromVideoType,
  },
} as const;

const s3 = new S3Client({});

export const exercisesMediaUploadHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/exercises/media/upload-url",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { kind, contentType } = ctx.body;
      const limit = LIMITS[kind];
      if (!limit.types.has(contentType.toLowerCase())) {
        ctx.set.status = 400;
        return { error: `Unsupported ${kind} type.` };
      }
      const key = `exercises/${userId}/${randomUuid()}.${limit.ext(contentType)}`;
      const { url, fields } = await createPresignedPost(s3, {
        Bucket: Resource.ExerciseMedia.name,
        Key: key,
        Conditions: [
          ["content-length-range", 1, limit.max],
          ["eq", "$Content-Type", contentType],
        ],
        Fields: { "Content-Type": contentType },
        Expires: 120,
      });
      return {
        data: { uploadUrl: url, fields, publicUrl: publicMediaUrl(key), key },
      };
    },
    {
      body: t.Object({
        kind: t.Union([t.Literal("image"), t.Literal("video")]),
        contentType: t.String({ maxLength: 100 }),
      }),
    },
  );
```

- `publicMediaUrl(key)` builds `https://<bucket>.s3.<region>.amazonaws.com/<key>` (same shape as `publicAvatarUrl`).
- `randomUuid` injected for deterministic tests.
- `ext`/type mapping is a pure helper (unit-tested).
- The `Resource.ExerciseMedia` cast mirrors the avatar handler's `Resource as Resource & { Avatars }` workaround until `sst-env.d.ts` regenerates.

Register the handler in the core API alongside the other exercises handlers.

**Persistence:** unchanged — after upload, the mobile client sets `thumbnailUrl`/`videoUrl` on the exercise via the existing `createExerciseCommand` / update path. `mapCreateExerciseInputToApi` already forwards `thumbnail_url` / `video_url`. No new DB work.

---

## Mobile

### Dependencies

Add `expo-image-picker` + (if not present) `expo-file-system`. Both Expo-managed.

### Port + adapter

- `domain/ports/api.port.ts`: `getExerciseMediaUploadUrl(input: { kind: "image" | "video"; contentType: string }): Promise<Result<{ uploadUrl: string; fields: Record<string,string>; publicUrl: string; key: string }, ApiError>>`.
- `adapters/api/sst-api.adapter.ts`: `POST /exercises/media/upload-url`.
- in-memory api adapter: canned presigned response for tests.

### Upload service — `adapters/media/exerciseMediaUploader.ts`

A thin, injectable wrapper so containers/tests don't touch `expo-file-system` directly:

```ts
// pickAndUpload(kind, deps): pick (expo-image-picker) → getUploadUrl (api)
//   → uploadAsync MULTIPART (expo-file-system) to {uploadUrl, fields}
//   → return publicUrl. Throws on permission denied / cancel / failure.
```

Client-side pre-checks size + type (friendly message) before requesting the URL.

### Form + UI

- Extend `NewExerciseInput` with `videoUrl?: string` (alongside the existing `photoUrl`). `toCreateExerciseInput` already maps `photoUrl → thumbnailUrl`; add `videoUrl → videoUrl`.
- `<ExerciseFormFields>` photo box: from no-op `Pressable` → on press, run `pickAndUpload("image")`; show a thumbnail preview + remove (✕) when set; a separate "Add video" affordance runs `pickAndUpload("video")` and shows a video chip + remove.
- Loading + error states; online-gate via NetInfo (disabled + hint offline).
- The composing container injects the uploader; the presenter stays declarative (callbacks + state in props) so it remains unit-testable.

---

## Testing strategy

- **Backend:** handler — type/kind validation (400), auth (401), success returns presigned `{ data }` with a `exercises/<userId>/` key + the right conditions; cross-user prefix safety; ext/type pure-helper unit tests. `createPresignedPost` + uuid injected/mocked.
- **Mobile:** adapter request/response mapping; `exerciseMediaUploader` (picker cancel, permission denied, size/type pre-check reject, happy path → publicUrl) with injected picker + uploadAsync; `<ExerciseFormFields>` photo/video set + remove + disabled-offline; `toCreateExerciseInput` maps both `photoUrl`/`videoUrl`.
- **Coverage:** ≥ 90% on changed files; pure helpers ~100% branches.

---

## Risks + mitigations

| Risk                                                   | Mitigation                                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large video through Lambda would hit payload limits    | Presigned POST → device uploads direct to S3; Lambda only signs.                                                                                                |
| Oversize / wrong-type upload                           | `content-length-range` + `eq $Content-Type` conditions reject at S3; client pre-check for friendly UX.                                                          |
| Cross-user writes via a crafted request                | Key prefix is server-derived from the JWT `sub`; client cannot choose the key.                                                                                  |
| Orphaned objects when a draft exercise is abandoned    | Acceptable for v1 (cheap); note a future lifecycle/cleanup rule (e.g. S3 lifecycle on an `unsaved/` prefix or a sweep of media not referenced by any exercise). |
| No virus/abuse scanning                                | Out of scope v1; note as hardening. Public bucket only serves what authed users uploaded under their prefix.                                                    |
| `expo-image-picker` permissions / platform differences | Request permission with a clear rationale; handle denial + cancel as non-errors.                                                                                |
