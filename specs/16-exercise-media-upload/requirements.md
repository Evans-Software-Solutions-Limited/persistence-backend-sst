# 16 — Exercise Media Upload: Requirements

> **New spec, authored 2026-06-03.** Adds real photo **and video** upload for custom exercises — a feature that never existed in the backend (legacy mobile only had commented-out stubs; the SST backend stores `thumbnail_url`/`video_url` as strings but has no way to populate them). Net-new backend: a new S3 bucket + presigned-upload endpoint. Scope confirmed by Brad (2026-06-02): **images + video** in one slice.

---

## Overview

In the Create-Exercise sheet (04.3) the "Add photo or video URL" box is currently a no-op placeholder. This spec makes it functional: the user picks an image or video from their device, it uploads to S3, and the resulting public URL is saved on the exercise as `thumbnailUrl` (image) or `videoUrl` (video).

Because **video files are large**, uploads do **not** go through the API Lambda (the avatar pattern, `profilesAvatarHandler`, streams a ≤ 5MB image through Lambda — fine for avatars, wrong for video against API Gateway/Lambda payload limits). Instead the backend issues a **presigned upload** and the device uploads bytes **directly to S3**.

Legacy reference: `../persistence-mobile/app/exercise-creator.tsx:74–128` — image/video pickers + upload were stubbed (`Alert: "will be implemented with expo-image-picker"`), with commented-out `uploadFileToSupabase`. So this is genuinely new, not a 1:1 port; we follow the legacy _intent_ (pick image or video, attach to the exercise).

Backend patterns to model on:

- `infra/storage.ts` — `avatarsBucket` (public-read S3 Bucket + CORS).
- `microservices/core/src/application/profiles/avatar/profilesAvatarHandler.ts` — authed media route + S3 client + public-URL construction.
- `packages/db/src/schema.ts:371–372` — `video_url` / `thumbnail_url` columns already exist; the create/update handlers already accept them (no migration needed).

---

## Locked decisions

| #   | Decision               | Locked value                                                                                                                                                                                                                                                         |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Upload mechanism       | **Presigned POST** (`@aws-sdk/s3-presigned-post createPresignedPost`) so a `content-length-range` condition enforces the size cap server-side and the device uploads **direct to S3** (no large payload through Lambda). Applies to both images and video.           |
| 2   | Bucket                 | New `sst.aws.Bucket("ExerciseMedia", { access: "public" })` with CORS allowing `GET/HEAD` **and** `PUT/POST` (presigned uploads come direct from the device). Public-read because exercise media is embeddable wherever a public/shared exercise is shown.           |
| 3   | Endpoint               | `POST /exercises/media/upload-url` — authed (Supabase JWT). Body `{ kind: "image" \| "video", contentType }`. Returns `{ uploadUrl, fields, publicUrl, key }`. No DB write — the URL is persisted by the normal create/update of the exercise.                       |
| 4   | Size + type caps       | Image: ≤ 5 MB, `image/jpeg\|png\|webp`. Video: ≤ 100 MB, `video/mp4\|quicktime`. Enforced via the presigned POST conditions (content-type + content-length-range); rejected by S3 if violated. Mirrored client-side for a friendly pre-check.                        |
| 5   | Key layout             | `exercises/<userId>/<uuid>.<ext>`. UUID per upload (the exercise may still be a `local-*` draft at upload time, so the key is not exercise-id-scoped). The public URL is stored on the exercise's `thumbnailUrl` (image) / `videoUrl` (video).                       |
| 6   | Mobile picker          | `expo-image-picker` (net-new dependency) for both image + video selection; `expo-file-system` `uploadAsync` (MULTIPART) for the presigned-POST upload. Both are Expo-managed, already-compatible with the SDK version in use.                                        |
| 7   | Online-only            | Upload requires the network — it is NOT queued offline. Offline, the picker/upload is disabled with a hint; the exercise can still be created without media (offline-first create is unaffected). The image-replacement/removal is local until the next online save. |
| 8   | No transcoding / thumb | v1 stores the raw uploaded file + uses it directly (video has no generated poster frame; the image doubles as the card thumbnail). Transcoding / poster generation is out of scope.                                                                                  |

---

## User stories

### STORY-001: As a user, I want to attach a photo to a custom exercise

**Acceptance Criteria:**

- 1.1 [ ] Tapping the photo box in the Create-Exercise sheet (04.3) / editor (04.6) opens `expo-image-picker` (images). Requests permission; denial shows a friendly message.
- 1.2 [ ] After selection, the app requests `POST /exercises/media/upload-url` (`kind: "image"`, the picked `contentType`), uploads the file direct to S3 via the presigned POST, and sets the returned `publicUrl` as the form's `photoUrl` (→ `thumbnailUrl` on save).
- 1.3 [ ] A thumbnail preview replaces the placeholder; a remove (✕) clears it back to the placeholder.
- 1.4 [ ] Upload shows progress/loading; failure → non-blocking message, box returns to empty, form otherwise intact.
- 1.5 [ ] Image > 5 MB or unsupported type → rejected with a clear message (client pre-check + S3 condition).

### STORY-002: As a user, I want to attach a video to a custom exercise

**Acceptance Criteria:**

- 2.1 [ ] The same box (or a sibling action) lets the user pick a **video**; `kind: "video"`, allowed types `video/mp4|quicktime`, ≤ 100 MB.
- 2.2 [ ] Upload uses the same presigned-POST flow; the `publicUrl` is set as the form's `videoUrl` (→ `videoUrl` on save).
- 2.3 [ ] Large video shows determinate progress where the uploader supports it; cancel/back aborts cleanly.
- 2.4 [ ] Video > 100 MB or unsupported type → rejected with a clear message.

### STORY-003: As the backend, I want to issue scoped, size-capped presigned uploads

**Acceptance Criteria:**

- 3.1 [ ] `POST /exercises/media/upload-url` (authed) validates `kind` + `contentType` against the allowlist for that kind; 400 on violation.
- 3.2 [ ] Returns a presigned POST scoped to `exercises/<userId>/<uuid>.<ext>` with `content-type` + `content-length-range` conditions (per decision #4); plus the eventual `publicUrl`.
- 3.3 [ ] Never returns a URL outside the user's `exercises/<userId>/` prefix (no cross-user writes).
- 3.4 [ ] The exercise create/update flow stores the returned `publicUrl` on `thumbnailUrl`/`videoUrl` (already-supported columns — no migration).

---

## Out of scope

- Video transcoding, poster-frame/thumbnail generation, format conversion (decision #8).
- Offline queueing of uploads (online-only, decision #7).
- Reusing media across exercises / a media library.
- Moderation / virus scanning of uploads (note as a future hardening item).
- Avatar/profile media (owned by 08).

---

## Dependencies and what this spec unlocks

- **Depends on:** 04.3 (the photo box in `<ExerciseFormFields>` + the sheet) merged. 04.6 editor reuses the same picker/upload wiring.
- **Adds:** the first device-direct (presigned) upload + the `expo-image-picker`/`expo-file-system` dependencies — establishes the pattern for any future large-media uploads.
- **Coordinates with:** `15-exercise-ai-classification` (both extend the same form/sheet) — land order is independent; whichever merges second rebases the shared `<ExerciseFormFields>` changes.
