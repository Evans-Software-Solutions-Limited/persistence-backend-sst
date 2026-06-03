# 16 — Exercise Media Upload: Tasks

> Authored 2026-06-03. Implements `requirements.md` + `design.md`. One backend PR + one mobile PR on a shared milestone branch (gate on the e2e smoke), or a single PR if kept small.

---

## Phase 16.1 — Backend presigned-upload endpoint (1 PR)

- [ ] **T-16.1.1** Add `exerciseMediaBucket = new sst.aws.Bucket("ExerciseMedia", { access: "public", cors: … })` to `infra/storage.ts`; link it to the API in `infra/api.ts`. Implements decision #2.
- [ ] **T-16.1.2** Author `exercisesMediaUploadHandler.ts` (`POST /exercises/media/upload-url`, `requireAuth`): validate `kind` + `contentType`; build a server-scoped `exercises/<userId>/<uuid>.<ext>` key; `createPresignedPost` with `content-length-range` + `eq $Content-Type` conditions; return `{ uploadUrl, fields, publicUrl, key }`. Register in the core API. Implements STORY-003 + decisions #1, #4, #5.
- [ ] **T-16.1.3** Pure helpers: `extFromImageType` / `extFromVideoType`, `publicMediaUrl(key)`. Unit-tested.
- [ ] **T-16.1.4** Add `@aws-sdk/s3-presigned-post` to the core service deps.
- [ ] **T-16.1.5** Tests: type/kind validation (400), auth (401), happy path (key under `exercises/<userId>/`, correct conditions, public URL), ext helpers. `createPresignedPost` + uuid injected/mocked. ≥ 90% coverage.

## Phase 16.2 — Mobile picker + upload (1 PR)

- [ ] **T-16.2.1** Add `expo-image-picker` (+ `expo-file-system` if absent) to `packages/mobile`.
- [ ] **T-16.2.2** Add `getExerciseMediaUploadUrl` to `domain/ports/api.port.ts` + `sst-api.adapter.ts` + a canned stub in the in-memory api adapter.
- [ ] **T-16.2.3** Author `adapters/media/exerciseMediaUploader.ts` (`pickAndUpload(kind, deps)` — picker → upload-url → `uploadAsync` MULTIPART → `publicUrl`; size/type pre-check; permission/cancel handled). Injectable deps for tests.
- [ ] **T-16.2.4** Extend `NewExerciseInput` with `videoUrl?`; `toCreateExerciseInput` maps `photoUrl → thumbnailUrl` (existing) + `videoUrl → videoUrl`. Update `exerciseForm` tests.
- [ ] **T-16.2.5** Make the `<ExerciseFormFields>` photo box functional (preview + remove) + add the "Add video" affordance (chip + remove); loading/error states; online-gate via NetInfo. Implements STORY-001, STORY-002.
- [ ] **T-16.2.6** Wire the sheet (04.3) + editor (04.6) containers to inject the uploader. Tests: uploader (cancel / denied / size-reject / happy), form set+remove, disabled offline, conversion maps both URLs. ≥ 90% coverage.

## Phase 16.3 — Verify

- [ ] **T-16.3.1** `bun run typecheck`, `lint`, `build`, `test:unit` (mobile gate via the node binaries per CLAUDE.md). Backend `test:unit` for the core service.
- [ ] **T-16.3.2** Manual e2e: pick an image → uploads → preview shows → save → exercise card shows the thumbnail. Pick a video → uploads → save → detail shows the video. Oversize image/video → rejected with a message. Offline → picker disabled with a hint; create-without-media still works.

---

## Acceptance gate

- [ ] Device uploads direct to S3 via presigned POST; the Lambda only signs.
- [ ] Size/type caps enforced at S3 (rejected) + pre-checked client-side.
- [ ] Keys are always under `exercises/<userId>/`; no cross-user writes.
- [ ] `thumbnailUrl`/`videoUrl` persist via the existing create/update path; no DB migration.
- [ ] Offline-first create is unaffected (media is online-only, never queued).
- [ ] CI green; ≥ 90% coverage on changed files.

---

_End of `16-exercise-media-upload/tasks.md` · 2026-06-03._
