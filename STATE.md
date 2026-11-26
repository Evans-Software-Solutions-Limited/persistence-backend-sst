# Project memory · persistence-backend-sst

### 2026-11-25 — BE-I2: coach calendar, bookings and session reminders ([PER-123](https://linear.app/evans-software-solutions/issue/PER-123); branch `claude/per-123-coach-calendar`)

Backend design I, calendar part (C4). Additive; nothing existing changes for
1.2.0. Migration `20261125123634_coach_sessions_calendar.sql` (sessions half
of migration 10; PER-122 owns the resources half) with a rollback.

- **Tables:** `coach_sessions` (one row per occurrence; weekly repeats are up
  to 26 rows sharing `series_id`; `revision`, `client_request_id` unique per
  trainer, `cancelled_at`, `reminder_minutes`, `workout_id` SET NULL) and
  `coach_session_attendees` (PK `(session_id, relationship_id)`, status
  invited/accepted/declined/cancelled, `reminded_at`). Drizzle in
  `packages/db/src/coachSessionsSchema.ts`, re-exported from `schema.ts`.
- **Push type:** `notification_type` `coach_session` (`ADD VALUE IF NOT
  EXISTS`), `data.action` = booked | moved | cancelled | reminder, plus
  `sessionId`, `startsAt`, `seriesId` (Brad, 25 Nov: one athlete type). Off
  the `/notifications/preferences` list so that contract is unchanged.
- **Routes** (`coaching/sessions/sessionsHandlers.ts`, mounted in
  `coachingRoutes.ts`): `GET /trainers/me/calendar?from=&to=` (≤ 62 days;
  `{sessions, formsDue, from, to, asOf}`), `POST /trainers/me/sessions`
  (`repeat: {frequency:'weekly', count ≤ 26}`, `Idempotency-Key`; returns
  `{data: first, series}`), `PATCH/DELETE /trainers/me/sessions/:id?scope=this|series`
  (`expectedRevision?` → 409 `revision_conflict`; `series` = this occurrence
  and the later live ones; a move shifts each the same way in the coach's
  local time), `GET /users/me/coach-sessions?from=&to=` (default next 62
  days; own booking only, no notes or other attendees), `POST
  /users/me/coach-sessions/:id/respond`. `GET /trainers/me/today`'s
  `schedule` is now today's live bookings in the coach's zone.
- **Events:** create/move/cancel writes one `session_booked` coach event per
  attendee, `noPush` (feed only); an athlete's accept/decline writes none
  (Brad, 25 Nov).
- **Reminders:** `sessionRemindersJob` appended to `COACH_SCHEDULER_JOBS`
  (15-minute `coachSchedulerCron`, no new infra): claim `reminded_at` then
  push, once per booked attendee from `starts_at − reminder_minutes` until
  the start; a move or reminder change clears `reminded_at`.
- **Offboarding:** step 4b in `endCoachClientRelationship` cancels the
  relationship's bookings on sessions that haven't started (sessions stay).
- **Tests:** `coaching/sessions/__tests__/coachSessions.integration.test.ts`
  (design I tests 1, 3, 4 on PGlite with the real migrations) and
  `sessionTimes.test.ts`. The other PGlite suites that run offboarding or the
  scheduler create the two tables in `BASE_TABLES`.
- **Not done here:** the coach-subscription guard for these `/trainers/me/*`
  routes comes from PER-146 (#565). App side is PER-144.

### 2026-11-26 — PER-137 follow-up: landscape-only photo viewer, final photo-sharing copy ([PER-137](https://linear.app/evans-software-solutions/issue/PER-137); branch `claude/per-137-landscape-viewer`)

- **Native change (Brad approved, 26 Nov; needs the new store build):**
  `expo-screen-orientation@~55.0.16` (not in 1.2.0), `app.json`
  `orientation: "default"` and the plugin with `initialOrientation:
  "PORTRAIT_UP"` (commit 498f05d).
- `src/lib/screenOrientation.ts`: `lockPortrait` / `lockLandscape`, guarded
  with `requireOptionalNativeModule("ExpoScreenOrientation")`. On a 1.2.0
  binary (OTA) they're no-ops, and the binary stays portrait natively.
- The root layout locks portrait at start. The Y3c viewer locks landscape on
  focus and portrait on blur/unmount, and its layout is the canvas's single
  landscape bar (Close, pose · date, weight / body fat / vs latest, Delete,
  Add). iPadOS ignores orientation locks with multitasking on.
- `PHOTO_SHARING_COPY` is Brad's approved wording (placeholder prefix
  dropped); `PHOTO_SHARING_CONSENT_VERSION` → `photos-v1`. The version is
  only stamped on new grants. Grants are matched on action, source and
  coaching cycle, so `photos-v0-placeholder` grants still count (integration
  test).

### 2026-11-25 — Coach resources follow-ups ([PER-150](https://linear.app/evans-software-solutions/issue/PER-150); branch `claude/per-150-resources-follow-ups`)

Follow-ups to PER-122. Backend only; no migration, no route added or removed,
no native change.

- **Count:** `/users/me/coaching` `resources` is now the per-coach count of
  what `GET /users/me/resources` shows (`countAthleteResources`). The list,
  the opened stamp and the count share one rule, `visibleToAthlete()` in
  `coaching/resources/resourceRepository.ts`.
- **C3.9 switch:** enforced like `photos_off`. With a coach's `resources`
  switch off for a client (stored `false`; missing = on), the athlete's list,
  `?since=` delta (reports them in `deletedIds`; settings `updated_at` is a
  delta trigger, so switching on brings them back), opened stamp (404) and
  count leave that coach out; `POST /trainers/me/resources/assign` answers
  403 `resources_off` with `clientIds` and assigns nothing. Assignments are
  kept, not removed. Other coaches of the same athlete are unaffected. The
  coach still sees the client's list and can remove items (Brad, 26 Nov:
  option a).
- **Purge:** the nightly `purgeStaleMedia` (account purge cron, no new
  schedule) also deletes `resource` uploads no `coach_resources` row points
  at once 7 days old (never saved, or replaced by a newer file), rows then
  objects in one transaction. Archived resources keep their files.
- **Tests:** `resources.integration.test.ts` PER-150 blocks (PGlite, real
  migrations); `coaching.integration` and `progressPhotos.integration` now
  apply the resources migration. Core suite 437 files / 6412 tests pass;
  lines 98.1%, branches 93.25%.

### 2026-11-25 — BE-G1b: programmes in order with Next, no dates ([PER-112](https://linear.app/evans-software-solutions/issue/PER-112); branch `claude/per-112-programmes-next`)

Design G part 2 (C3.1, Assign with no start date). Backend only, additive.

- **Migration** `20261125101831_programme_sequence_mode.sql` (+ rollback):
  `program_assignments.schedule_mode` (`dated` default / `sequence`, CHECK),
  `workout_assignments.sequence_index` + partial index. Mirrored in schema.ts.
- **Sequence assignments** (`assignProgrammeInSequence`, the one helper):
  `start_date` = assignment date, `end_date` NULL, every workout created once
  with `due_date` NULL and `sequence_index` (= `occurrence_index` = cycle
  position k). Indefinite ones keep 4 weeks × days/week open, topped up in
  `ensureMaterializedForClient`. Next = lowest open `sequence_index`;
  completing any workout links its lowest open occurrence (out of order is fine).
- **Entry points:** coach `POST /trainers/me/programs/:id/assign` with no
  `startDate` (with one = dated, unchanged for 1.2.0); the `programme` set-up
  section (`programs/programmeSetupHandler.ts`, one line in `HANDLERS`);
  `POST /users/me/program-assignments` ("Me", trainer role + active coach plan (PER-146), own programmes only:
  design G's "or public" deferred pending Brad after Inspector Brad #564; re-send returns
  the first row). Mounted via `programs/programsAthleteRoutes.ts` (TS2589).
- **Reads:** `scheduleMode`, `nextAssignmentId`, `weekOfProgramme {week, of}` on
  the Home card / coach active programme / relationship aggregate, athlete
  `GET /programs/:id` and coach programme detail assignments; optional
  `sequenceIndex` on Today's training, coach open assignments, upcomingWorkouts.
  **`weekOfProgramme` for PER-115:** `programmeOrderFieldsFor` /
  `weekOfProgramme` in `programs/sequenceProgress.ts` + `scheduling.ts`.
- **1.2.0 safety:** Home Today's training and dashboard show only Next of a
  sequence programme (`isNextOrNotSequenced`), else the whole undated plan would
  appear. `week` keeps its calendar meaning. Unassign also prunes undated
  untouched rows. `programme_ending` fires for finite sequence programmes at ≤ 2
  left (dedupe `programme_ending:<id>:sequence`).
- **Open:** "athlete planning capability" for "Me" doesn't exist in code; non-
  trainers get 403 `planning_not_available` (question for Brad).
- Tests: `programs/__tests__/designG.sequence.integration.test.ts` (PGlite, real
  migration) and `scheduling.sequence.test.ts`; `scheduling.test.ts` unchanged.

### 2026-11-25 — APP-F1 athlete progress photos: gallery, phone-camera capture, portrait viewer, offline uploads ([PER-137](https://linear.app/evans-software-solutions/issue/PER-137); branch `claude/per-137-athlete-photos`)

Mobile only, over the air on 1.2.0, no native change. Uses BE-F1 (#553).

- **Screens:** Y1 You page gallery row (latest set; "See all"; with no
  photos: three empty grey blocks + "Add today's photos", Brad 25 Nov), Y3
  Gallery (`/(app)/progress-photos`, same grey blocks when empty), Y3b Add
  photos (`/(app)/progress-photos-add`), Y3c viewer
  (`/(app)/progress-photo-viewer?setId=&pose=`, full screen, still portrait:
  Brad wants it landscape-only, which needs `expo-screen-orientation` — not
  in 1.2.0 — and is pending). Delete is a trash button with a confirm (Brad
  approved).
- **Capture:** the app's shared picking flow (`ui/hooks/imagePicker.ts`,
  extracted from `useAvatarUpload`, which now uses it too: Camera / Photo
  Library alert → permission → system picker) → `expo-image-manipulator`
  JPEG, long edge ≤ 2048 px (`resizeToLongEdge`), size measured for the
  pinned upload.
- **Offline:** a saved set is a `pending_progress_photos` row (new SQLite
  table, one JSON payload per set). `processProgressPhotoUploads` (end of
  `sync.command.ts`) runs create (same `Idempotency-Key` every try) → PUT
  each photo to the presigned link → complete, with back-off 5 s → 1 h and no
  give-up on transport/5xx/408/429/upload errors; other API 4xx → `rejected`,
  a gone file → `file_missing` (both stop, shown "Couldn't upload").
  `useProgressPhotoUploadWorker` (mounted beside `useSyncWorker`) runs it
  only while online: on mount, save, foreground, reconnect and when the next
  retry is due. No `expo-file-system` (Brad, 25 Nov).
  Delete and the sharing grant use the JSON sync queue.
- **`expo-file-system`:** in the 1.2.0 binary (55.0.22, a dependency of
  `expo`), but not importable without adding it to
  `packages/mobile/package.json` (out of bounds while PER-147 edits it). So
  the design's fallback is used: unsent photos stay where the manipulator
  wrote them (the cache directory) and the gallery warns they could be lost.
  Files are read with RN `fetch(file://…).blob()`.
- **Gallery cache:** `cached_progress_photos` (full read each time; links
  last 15 min); images cached by `expo-image` with `cacheKey` = photo id.
- **Sharing prompt:** after Save, if `photoSharing.needsPrompt` and the
  athlete hasn't answered for those coaches on this phone; body is the
  server's `copy` (`PHOTO_SHARING_COPY` placeholder from PER-121).
- **Copy:** Brad approved the drafted wording (25 Nov). `PHOTO_SHARING_COPY`
  (backend, PER-121) is still the placeholder text.

### 2026-11-25 — Mobile forms on react-hook-form + TypeBox ([PER-147](https://linear.app/evans-software-solutions/issue/PER-147), 2 of 2; branch `claude/per-147-rhf-mobile`)

Every mobile form added since 1.2.0 validates through `react-hook-form` with
a TypeBox schema resolver. Same copy, layout and offline queueing; no native
change (`react-hook-form`, `@hookform/resolvers` v6 and `@sinclair/typebox`
0.34 are pure JS). Web is PR 1 of 2 (`packages/web/src/lib/form`, same API).

- **Pattern (PER-130 builds on it):** `src/shared/form/` (`schemaResolver`
  with `prepare(values, context)` and `refine`, `schemaAccepts` for a button
  that is off until valid, `applyServerErrors` reading `{ status, body }` or
  the adapter's raw `{ status, json }`). Schemas live in `src/ui/forms/*.ts`;
  containers own `useForm` and submit with `handleSubmit`. Rules that depend
  on screen state (meals ticked, a full meal) go in through RHF `context`.
- **Forms:** invite code + C11j consent tick, Your meals rename/add and the
  plan's meals sheet, Quick log and a plan's quick item, New plan, builder
  Save, item amount (add and edit), plan rename, coach form editor, send
  sheet (C10h), one-client set-up (C10j), check-in reply.
- **Removed hand-rolled checks:** `draftProblem` (coachForms.service, now the
  editor schema + `firstFormProblem`, same lines and order) and
  `QuickLogDraft.canLog`. `canSendSheet` stays as a name, backed by the
  schema.
- Submits are async now; NameInputs guard against return-then-blur
  submitting twice. Queued saves still report 409s through the queue's
  conflict state.
- **Shared limits (Brad, 25 Nov):** `@persistence/form-limits` (same commit
  as web #561: package + core routes). Mobile's coach-form, schedule, reply,
  user-meal count and plan-name constants now come from it. Meal names stay
  at 40: `user_meals_name_len_chk` stores 1–40 although the route's schema
  says 80 (left unchanged; flagged to Brad).

### 2026-11-25 — Web forms on react-hook-form + TypeBox ([PER-147](https://linear.app/evans-software-solutions/issue/PER-147), 1 of 2; branch `claude/per-147-rhf-web`)

Every web form added since 1.2.0 validates through `react-hook-form` with a
TypeBox schema resolver. Same copy, layout and save behaviour; no backend or
native change. Mobile is PR 2 of 2.

- **Shared helpers:** `packages/web/src/lib/form/`. `schemaResolver(schema,
  { prepare, refine })` wraps `@hookform/resolvers/typebox` (v6, which uses
  `@sinclair/typebox` 0.34, the same TypeBox Elysia uses; v7 moved to `typebox`
  1.x). Copy comes from `errorMessage` on the schema (one string, or one per
  `ValueErrorType` name), via a TypeBox error function installed on import.
  `prepare` checks trimmed values (the server trims); `refine` adds
  cross-field rules (weekly needs a day, min ≤ max). `applyServerErrors` puts
  422/409 field errors (`validation[].path`, `errors[].at`, `field`, or a field
  named in the message) onto mapped fields with the form's copy, else returns
  false and the old banner shows.
- **Forms:** Who, set-up sections (one form per open section; drafts still
  drive the unmount save, whose check is now the same schema via
  `setupProblem`), declaration tick, C3.9 settings (each change is checked
  before it saves), form editor (live problems from RHF errors;
  `questionProblems` removed), send dialog, one-client rule (C10j), check-in
  reply, coach sign in. Schemas live in `coach/lib/*Form.ts`.
- **Shared limits (Brad, 25 Nov):** new dependency-free package
  `@persistence/form-limits` (plain constants). The Elysia routes (client
  profiles, set-up, C3.9, coach forms, send rules, reply, user meals, meal
  plans) and the web form schemas both import it. Same values as before,
  pinned in the package test and core `coaching/__tests__/formLimits.test.ts`;
  no API behaviour change. Mobile (#566) carries the identical commit.
- **New copy** (approved by Brad, 25 Nov) appears only where the server
  refuses what the form allowed (e.g. "Choose a day to send it.").

### 2026-11-25 — BE-D3: Mealprint 3 swap options, Your meals in generation, save a day as a plan ([PER-119](https://linear.app/evans-software-solutions/issue/PER-119); branch `claude/per-119-mealprint-swaps`)

Design D "Mealprint (PER-41)" section. Additive only; no migration, no
schema change, no native change. `nutritionRoutes.ts` untouched.

- **`POST /nutrition/ai/plan-meal-swap` `count?: 1 | 3`.** Absent = the
  1.2.0 body exactly (`data.meal`, no `options`; pinned by a recorded-shape
  test). With `count`, `data.options[]` is added, `options[0]` deep-equals
  `data.meal`, and the empty bodies carry `options: []`. `count: 3` is ONE
  model call (`composeDayPlan` with `alternatives: 3`, a separate prompt:
  each option fits the remaining target alone, options must differ). Each
  option is verified on its own (`verifySwapMeal`: portion policy, macros
  recomputed, avoidance re-run) and a failing one is dropped, as is a repeat
  (same normalised name or same food names) or a match for `notWantedMeals`
  by name or by ingredient set (`selectSwapOptions`). Never padded: it can
  return 1–2 options; none left → 422 `ai_unreadable`. `count` 1 and absent
  keep the old 422-on-any-failure behaviour. One call = one swap against the
  10/day ceiling. The `meal_plan_swap` cost profile in
  `subscription-catalog/aiCosts.ts` still assumes ~300 output tokens (not
  changed: outside the brief).
- **`POST /nutrition/ai/plan-generate` `meals?: [{name (1–40), logSlot}]`
  (2–6)** replaces `mealsPerDay` (meals.length wins). The names go into the
  prompt as bounded JSON data; each composed meal fills the requested meal
  at its model-output `position` (new `ComposedPlanMeal.position`, kept
  when a non-member meal is dropped), takes that meal's slot and gets
  `label` = its name (only when `meals` was sent) for `POST /nutrition/plans`.
- **`POST /nutrition/meal-plans {fromMealprintPlanId, name?}`** (body is a
  union with the manual `{name, meals}`): `fromMealprint.ts` turns the
  owner's dated `meal_plans` row into a list plan (`source: 'mealprint'`,
  `sourcePlanId` = dated plan; the dated plan is only read). Default name
  `Mealprint`. Food servings convert from Mealprint's pack serving to the
  row's `serving_size` units (`foodServingScale`, now exported from
  `mealprintCandidateRepository`); recipe/saved-meal servings are recovered
  as `(meal.kcal − foods) / (recipe per serving + meal kcal)`; a row whose
  sources were all deleted keeps its frozen macros as a one-off item. A
  source that no longer resolves → 409 `plan_meal_nutrition_unavailable`
  with `items`; another user's or unknown dated plan → 404
  `mealprint_plan_not_found`; `manual_meal_plans` capability and
  `Idempotency-Key` as for manual create.
- Tests: `planSwapOptions.test.ts` (real composer + assembly + avoidance,
  fake Bedrock client; no provider calls), generate `meals` cases,
  `planModel` prompt modes, `fromMealprint.test.ts`, and a PGlite block in
  `mealPlans.integration.test.ts`.

### 2026-11-25 — Coach platform access: coach subscription required ([PER-146](https://linear.app/evans-software-solutions/issue/PER-146); branch `claude/per-146-coach-platform-access`)

The coach workspace is only for coaches with an active coach subscription
(Brad, 24 Nov). No migration, no native change, no mobile change.

- **Backend:** `application/entitlement/coachSubscriptionGuard.ts`.
  `coachWorkspaceGuard` is mounted once at the top of `src/api.ts` as a global
  `onBeforeHandle`; it refuses every coach workspace route (route pattern
  `/trainers/me` / `/trainers/me/*`, plus legacy `/clients/:clientId/measurements`
  and `/clients/:clientId/body-trend`) with `403 { code:
  "coach_subscription_required" }` unless the caller's effective tier is a coach
  tier. "Coach tier" reuses `resolveTrainerClientsEntitlement().isTrainerTier`
  (catalog `is_trainer_tier`, lapse/cancel/scheduled-change rules shared with the
  seat cap); founding/admin grants count. No valid JWT → steps aside, the route's
  own 401 answers. New `/trainers/me/*` routes (e.g. PER-122) are covered with no
  code; a coach group outside that prefix adds `.use(coachSubscriptionGuard)`.
- **1.2.0 effect:** coaches without an active coach subscription now get 403 on
  the coach screens' calls; paying coaches are unchanged. Route list in the PR.
- **Web:** `CoachLayout` sends non-coach roles and a roster refused with the code
  to `/pricing?for=coaches&from=coach` (replaces the "isn't a coach account"
  dead end); `coachFetch` notifies `onCoachSubscriptionRequired` on any refused
  call, so a mid-session lapse redirects too. Pricing opens the Coaches tab on
  `?for=coaches` and explains the coach plan when `from=coach`. Marketing nav and
  footer gain "Coach sign in" (`/coach/login`, full page load).
- **Tests:** `coachSubscriptionGuard.test.ts` (PGlite, real resolver: active,
  founding, lapsed, cancelled, athlete, no sub, signed out, mid-session lapse,
  nested sub-apps, sibling groups); web `shellAndList`, `api`, `Pricing`.

### 2026-11-25 — BE-I1 coach resources: library, assignment, opened ([PER-122](https://linear.app/evans-software-solutions/issue/PER-122); branch `claude/per-122-coach-resources`)

Backend design I, resources part (C3.7, C5b, athlete resources). Additive; no
existing route changes. Migration `20261125101829_coach_resources.sql`
(rollback in `supabase/rollbacks/`): `coach_resources` (file via
`private_media` purpose `resource`, or https link; CHECKs pin kind/url/media),
`coach_resource_assignments` (live-unique `(resource_id, relationship_id)
WHERE removed_at IS NULL`). Drizzle in `packages/db/src/coachResourcesSchema.ts`
(re-exported from `schema.ts`, like PER-121).

- Code: `microservices/core/src/application/coaching/resources/`
  (repository, handlers, `resource` set-up handler). Mounted as
  `coachResourcesRoutes` in `coachingRoutes.ts`; `api.ts` untouched.
- Routes: `GET/POST /trainers/me/resources`, `PATCH/DELETE
  /trainers/me/resources/:id`, `POST /trainers/me/resources/assign`,
  `GET /trainers/me/clients/:clientId/resources`, `DELETE
  /trainers/me/clients/:clientId/resources/:assignmentId`, `GET
  /users/me/resources?since=`, `POST /users/me/resources/:assignmentId/opened`.
  Files are checked with design F's `finaliseMedia` on save; athletes get a
  15-minute signed link. Archiving a resource hides its assignments from
  clients (`deletedIds`).
- Offboarding step 3e removes this coach's assignments on the relationship
  (`removeResourceAssignmentsForRelationship`), so a revived relationship
  doesn't bring them back. Set-up section `resource` is live.
- ⚠ PER-146's coach-subscription guard must be applied to
  `coachResourcesHandler` (the coach group) once both are merged.
- Not done (out of brief): `/users/me/coaching` `resources` count stays 0;
  the C3.9 `resources` switch is not enforced server-side; unused ready
  resource uploads are not purged.
- Tests: `resources.integration.test.ts` (PGlite, real migrations; design I
  tests 1, 2, 5, set-up, migration twice/rollback). Other offboarding suites
  now create the two tables.

### 2026-11-24 — Tooling: TypeScript 7, Oxlint (tsrs type-aware), Vitest 5, Vite 8 ([PER-148](https://linear.app/evans-software-solutions/issue/PER-148); branch `claude/brave-dirac-h9ianz`)

Cuts check time, which was the cause of CI and local timeouts. No CI caching
was added (Brad: CI should always run cold). No runtime, app or native change.

- **TypeScript 7.0.2** in every workspace. TS 7 has no automatic `@types`
  loading and no `baseUrl`, so `packages/db` and `packages/mobile` list
  `types`, and `packages/web` drops `baseUrl` (`paths` now resolve from the
  tsconfig). `noUncheckedSideEffectImports` is on by default, so the web
  fontsource imports name `index.css` explicitly (same file).
- **Mobile keeps `typescript@~5.9`** as its `typescript` module because
  Expo's config loader (`@expo/require-utils`, used by `expo start`/EAS for
  `app.config.ts`) calls `ts.transpileModule`, which the TS 7 package does not
  export. Mobile typechecks with TS 7 through the `typescript-7` npm alias
  (`node node_modules/typescript-7/bin/tsc`). Drop the alias once Expo
  supports TS 7.
- **ESLint → Oxlint 1.95** (`oxlint` + `tsrs` at the root). Each package's
  `eslint.config.js` was converted with `@oxlint/migrate` into `.oxlintrc.json`
  (same rules). typescript-eslint (≤ 8.74) does not load under TS 7, so ESLint
  could not stay. Mobile: `oxlint src app` (the folders `expo lint` covered);
  `eslint-plugin-expo` and the custom `eslint-rules/no-raw-hex-colors.js` run as
  Oxlint JS plugins; its override exemptions are an `off` override because
  Oxlint has no `ignores` inside overrides. `eslint` stays in mobile only for
  the rule's `RuleTester` unit test.
- **Type-aware (tsrs):** core, other-service, api-utils, seed and web set
  `options.typeAware` with `no-floating-promises`, `no-misused-promises` and
  `await-thenable` as errors. Backend was clean apart from two
  `await-thenable` cases in `progressPhotos.integration.test.ts` (narrowing of
  a callback-assigned `let`; now restated). Web: `no-misused-promises` has
  `checksVoidReturn.attributes: false` (async JSX handlers; React ignores the
  return); the 23 floating promises (mostly react-router `navigate()`) get
  `void` (no runtime change); test `fetcher` mocks are typed to return
  `Promise<Response>`. Mobile has the same rules too: 145 floating promises
  (in-memory `storage.initialize()`, which completes synchronously, `act()`,
  `invalidateQueries()`, Supabase auto-refresh, `AsyncStorage.setItem`) get
  `void`; `checksVoidReturn.properties` is off for `Alert` button `onPress`
  handlers; `await-thenable` is off in mobile tests only, where awaiting a
  void-typed presenter callback is how a test waits for the container's
  async work. Gotcha: root `typescript/*` rules are silently ignored unless
  `typescript` is in the root `plugins` list.
- **More type-aware rules, every package:** `switch-exhaustiveness-check`
  (`considerDefaultExhaustiveForUnions`: an explicit `default:` counts),
  `only-throw-error` and `prefer-promise-reject-errors` (rethrowing a caught
  `unknown` allowed; off in tests, which throw strings on purpose; mobile
  allows its Result error types `ApiError`/`StorageError`/`AuthError`/
  `ValidationError`/`TogetherOfflineApiError`/`PurchasesError`, which hooks
  throw into TanStack Query), and `no-base-to-string`. Real fixes: new
  `errorMessage()` helper (core `src/shared/errorMessage.ts`, copied to mobile
  `src/shared/errors/`) so non-`Error` rejections log their message/JSON
  instead of "[object Object]" (errorHandler, the three "already cancelled"
  checks, mobile requestLog); coach form answers render malformed objects as
  JSON (web `forms.ts`, mobile `coachForms.service.ts`); web admin voucher form
  fields read via `field()` (a missing field was the string "null"); mobile
  `cloudSchema` checks `audience` is a string. Elsewhere `String(x as …)`
  states schema-validated or stored types. `db`, `training-metrics`,
  `subscription-catalog` and `scripts` now lint too (clean).
- **Vitest 2.1.9 / 4.0.18 → 5.1.1** everywhere it is used (core,
  other-service, scripts, api-utils, subscription-catalog, training-metrics,
  web). Since Vitest 4 a mock called with `new` needs a constructible
  implementation, so 265 class mocks (`Repo: vi.fn(() => mocks)`,
  `.mockImplementation(() => …)`) became `function () { return …; }` — same
  objects, no assertion changed. Vitest 5 also types mocks more strictly
  (`MockInstance<typeof console.warn>` for spies; `vi.fn<(userId: string) =>
  Promise<boolean>>` in `accountPurgeCron.test.ts`). `clearMocks` is now on by
  default; no test depended on history carried between tests.
- **Vite 7.3 → 8.3.8** in web (Rolldown), with `@vitejs/plugin-react-swc`
  4.3.3, `vite-plugin-pwa` 1.3.0 (kept on 1.x; the plugin is due for removal),
  `tailwindcss`/`@tailwindcss/vite` 4.3.5. `vite.config.ts` uses
  `import.meta.dirname`. Same 40 output files and 1.5 MB as Vite 7.
- Oxlint also found 3 `no-unsafe-optional-chaining` cases ESLint missed (core
  `sessionRepository.test.ts`, web `coach/__tests__/api.test.ts`), now fixed,
  and 7 non-blocking `import/no-named-as-default-member` warnings in mobile.
- **Measured** (4 cores, `--force --concurrency=1`): typecheck 79s → 17s,
  lint 63s → 6s; mobile typecheck 21.5s → 2.8s; core lint 9.8s → 0.1s
  (1.7s type-aware); web `vite build` 4.59s → 0.75s; web tests 68s → 59s.
- **Verified:** prettier, typecheck, lint, build (all packages, uncached).
  Unit tests on Vitest 5: core 435 files / 6,357 tests (434 / 6,352 on Vitest 2,
  plus the new errorMessage tests),
  web 99 / 1,978, scripts 245, api-utils 27, training-metrics 54,
  subscription-catalog 14 — all pass. Core coverage 97.56 / 93.12 / 97.9 /
  98.06 (was 98.52 / 94.94 / 98.35 / 98.52 on Vitest 2: v4+ counts branches
  more precisely; still above the 90% thresholds). Mobile (Jest, untouched): 9,677 pass,
  34 fail in the two suites already known to fail (see the PER-129 entry).

### 2026-11-24 — APP-C1 iPhone: K-layout coach shell, Library → Forms, send sheet, editor, Check-ins tab ([PER-129](https://linear.app/evans-software-solutions/issue/PER-129); branch `bradleysimmsevans/per-129-app-c1-iphone`)

Mobile half of PER-129 (PR 2 of 2; stacked on PR 1, #555, which has the
backend, the web screens and the BRIEF). Contract: `specs/per-129-coach-forms/BRIEF.md`.
No native change, no version bump, no local-DB schema bump.

- **K shell (coach mode):** Today · Clients · Library · Messages · You
  (`COACH_TABS`). Library (`(tabs)/library.tsx`, `CoachLibraryContainer`):
  Workouts · Programmes · Meals · Resources · Forms in the C10g board's order,
  Forms open first; Programmes embeds the existing hub
  (`CoachLibraryHubContainer embedded`); Workouts/Meals/Resources and the
  Messages tab are dashed "In development". `(tabs)/programs.tsx` redirects to
  `library?segment=programmes` (stranded-route guard skips it in coach mode).
- **Screens:** C10g (`FormsLibraryPresenter`), form page + C10h send sheet
  (`/coach-forms/[id]`, `?send=1&sendTo=&trigger=&scheduleId=`), C10b editor
  (`/coach-forms/edit[?id=]`), client tab strip on `/clients/[id]`
  (`?tab=`; Overview unchanged, Habits opens the habits screen, others
  placeholders), C3.3b (`ClientCheckInsContainer`) with C10j sheet and the
  review screen (`/clients/[id]/responses/[responseId]`).
- **Offline:** caches `cached_coach_forms`, `cached_coach_form_schedules`,
  `cached_coach_form_stats`, `cached_coach_client_forms`,
  `cached_coach_form_responses`, plus `coach_form_conflicts` (init DDL,
  cleared in `clearAll`). Queue entity types (`coachForms.command.ts`):
  `coach_form` (keyed POST / PATCH + `expectedRevision`),
  `coach_form_schedule` (same), `coach_client_form_setup` (PUT),
  `coach_form_review` (POST). Edits fold into never-sent rows; later queued
  PATCHes rebase onto the server's new revision; offline creates swap
  `local-…` ids in caches and queued rows (`swapLocalCoachForm*Id`).
- **409 `revision_conflict`** (`applyCoachFormsConflict`, hooked in
  `sync.command.ts`): cache takes `current`, every queued PATCH of that
  form/rule is discarded (never retried), conflict recorded → "Edited on
  another device" on the library row, form page, editor and send sheet.
- **Known limit:** a PATCH whose reply is lost after the server committed is
  retried with the old revision and 409s against its own change, so the
  notice can show for the coach's own edit (content is still theirs).
- **Verified:** mobile typecheck, lint, prettier on changed files. Mobile
  `test:unit`: 9,389 pass, coverage 96.4 / 92.2 / 96.4 / 97.7
  (stmts/branches/funcs/lines). 34 failures in 2 suites, neither touched here:
  `SubscriptionSelectionContainer` (fails on main) and
  `AddClientSheetContainer` (361 s under load; 24/24 pass alone).
- **Not verified:** nothing run on a device or against staging.

### 2026-11-24 — APP-C1 (web + backend): coach forms library, editor, send, Check-ins tab ([PER-129](https://linear.app/evans-software-solutions/issue/PER-129); branch `bradleysimmsevans/per-129-app-c1-coach-web-iphone-forms`)

PR 1 of 2 on PER-129: backend extensions and the web screens. The iPhone half
(K-layout coach shell, C10g/h/j, C3.3b, offline) is PR 2 on
`bradleysimmsevans/per-129-app-c1-iphone`, stacked on this branch's backend
commit. Brief: `specs/per-129-coach-forms/BRIEF.md`. No migration; no native,
version or mobile change in this PR.

- **Brad's calls (24 Nov, in session):** close the API gaps here rather than
  hide canvas items; build the iPhone K shell in this ticket.
- **Backend (additive, 1.2.0-safe; no migration, everything is jsonb or a new
  read):**
  - `GET /trainers/me/forms/stats` (`coaching/forms/statsRepository.ts`): per
    form, each active client's LATEST request in the current coaching cycle
    (reached / done / outstanding, `lastReminderAt` from the rule or the
    client's override), and totals (live forms, repeating, outstanding, on
    time over requests due in the last 28 days). Cancelled requests and ended
    relationships are left out.
  - Questions take `help` (≤ 300), `detailsIfYes` (yes/no only; an answer may
    be `{value, details}`, stored as the object only when there are details)
    and `prefill` (`sessions_done`, `meal_plan_followed`, `steps`, `weight` on
    number questions; `progress_photos` on photo). The athlete app fills and
    saves them (PER-130).
  - Per-client cadence (C10j): `override.trigger` ∈ once/weekly/daily on a
    once/weekly/daily rule (`checkOverride`, completeness falls back to the
    rule's day/time; stored only when it differs). `generateOnce` sends to
    targets whose effective cadence is once; `formPeriodsJob` also picks up
    once rules with a weekly/daily override and uses the effective trigger
    for periods, keys and missed marks. Join/exit forms can't change cadence.
- **Web (`packages/web/src/coach`):** Library is live in the rail
  (`/coach/library/forms`); `forms/FormsLibrary(+Container)` C10a + C10c send
  dialog (`/:formId/send`, `/:formId/change`, `?when=`, `?client=`),
  `forms/FormEditor(+Container)` C10b (`/new`, `/:formId/edit`),
  `forms/RuleFields` (when/day/time/due/reminders; hours after the send shown
  as day + time), `checkins/CheckinsTab(+Container)` C3.3a at
  `/coach/clients/:id/check-ins`, `checkins/ClientFormPanel` C10j side panel.
  Pure rules in `lib/forms.ts`. 409 on a form or rule → server copy +
  "Edited on another device. You're seeing the latest."
- **Not on the canvas / differences:** "Opened, not sent" isn't tracked
  (rows say "Reminder sent …" or "Sent …"); no voice replies; "Synced to
  Body" and filled-for-them values come from PER-130; reorder is Move up /
  Move down in the question panel (the grip is visual); a Templates empty
  state (none seeded); a "Not sent yet" group for forms with no rule; one
  photo per photo question (canvas: front, side, back); no global stop for a
  rule (only per client, as scoped).
- **Tests:** backend PGlite — stats (latest per client, reminders from rule
  and override, on-time, cycles, isolation), question extras over HTTP,
  per-client cadence in the scheduler (weekly→daily, once→weekly,
  weekly→once, invalid changes); web — containers (library, send, change +
  409, editor all 8 types + 409 + errors, Check-ins compare/review/reply,
  C10j cadence/pause/resume/stop, offline), presenters, `lib/forms`, API.
- **Not verified:** nothing run against staging or in a browser against the
  live API (screenshots are off for this release).

### 2026-11-23 — APP-D2: athlete Plan tab (mine and from coaches), New plan, Meals tab, shopping list ([PER-133](https://linear.app/evans-software-solutions/issue/PER-133); branch `bradleysimmsevans/per-133-app-d2-athlete-plan-tab-mine-and`)

PR #554 (open, no auto-merge). Mobile only: no backend, migration, native or
version change. Uses the merged PER-118 routes (`/nutrition/meal-plans*`, `/nutrition/shopping-list*`) and
PER-109/132's `/nutrition/entries/batch` replay. Ships in the next store
release, reviewed on staging.

- **Data layer:** `domain/models/nutritionPlans.ts`,
  `domain/services/nutritionPlans.service.ts` (Target · Planned · To plan
  against the person's OWN target, items, drafts, ?since= merge, local-intent
  overlay, plan → log entries), `application/commands/nutritionPlans.command.ts`.
  Two new SQLite tables `cached_nutrition_plans` and `cached_plans_shopping`
  (CREATE TABLE IF NOT EXISTS, no schema-version bump); StoragePort
  `get/cacheNutritionPlans`, `swapLocalNutritionPlanId`,
  `get/cachePlansShopping`; ApiPort `getNutritionPlans(since)`,
  `getPlansShoppingList()`. Warmed in `warmOfflineData`.
- **Queue entities:** `nutrition_plan` (create/duplicate with local id +
  Idempotency-Key; PUT with `expectedRevision`, folded edits; DELETE),
  `nutrition_plan_assignment` (added/dismissed/seenRevision folded per plan),
  `shopping_list_plan`. `sync.command.ts` gained two hooks: a synced plan
  reply swaps the local id and adopts the server copy (later PUTs move to the
  new revision); a PUT 409 keeps the server's `current`, flags the plan
  (`conflictPlanIds` → "changed on another device" note) and resolves the
  row; a 409 that IS our own committed edit (lost reply) is not a conflict.
- **Add to today:** `addPlanToDayCommand` builds entries from the cached plan
  (item macros, Your meal by name else slot default, `sourcePlanId` /
  `sourcePlanMealId` for server ids only) and logs each through
  `logEntryCommand`, so PER-132's batch replay sends them with their own keys.
  Logged food keeps its own macros; a coach edit only changes the plan.
- **Screens:** Fuel sections now switch in place (`FuelContainer` section
  state). Plan = `PlanTabContainer`/`PlanTabPresenter` (N6/N8/N10), root
  sheets `PlanSheetsContainer` (N7 Your plans, C6 coach plan with Not now /
  Add to my plans; `state/plan-sheets.ts`). Builder (N28/N28b/N29/N32/N34/
  N30/N31/N33) in `ui/containers/plans/*`, `ui/presenters/fuel/plans/*`,
  `state/plan-draft.ts`, routes `fuel/plan-new|plan-edit|plan-add`. Meals tab
  `MealsTabContainer` (N11/N12) + `LogMealSheet*` (N14) + `AddToPlanSheet*`,
  wired into the existing meal/recipe detail screens. Shopping list
  `PlansShoppingListContainer` (N23), route `fuel/plans-shopping`.
- **Gate:** `useManualMealPlansGate` (Premium, Premium+, coach tiers) gates
  New plan only; Free can receive, view, duplicate and log coach plans.
  `liveTierName` added to `useMealprintGate.ts`.
- **Tests:** offline add-to-today with replay and a lost reply (no
  duplicates), PUT 409, Free user receiving a coach plan, a coach edit not
  changing logged food, real-SQLite id swap, hooks, presenters, containers.
- **Verified:** prettier:check, typecheck, lint, build. test:unit: web and
  core pass; mobile 699/701 suites (96.2 / 92.0 stmts/branches).
  `SubscriptionSelectionContainer` hangs (failing on main too);
  `PlanTodayContainer` timed out under load, passes alone.
- **Inspector Brad on #554: nineteen sweeps, case closed on `548d126`
  (24 Nov).** Every lead was confirmed and fixed with a failing-first
  regression test. Main themes: one-off macros sent per serving; local-id
  aliases and own revisions so synced plans keep picks, notices and edits;
  per-entity ordering holds in the queue; shopping-list read races and
  retries; C6 auto-open waits for focus and other sheets. Late sweeps added
  the server's caps on the phone: servings floor at 0.01; at most 20 meals
  (empty meals dropped first) and 50 items a meal. Full meals say "… is
  full. Pick another meal." / "… has room for N more items." and turn the
  action off, and New plan refuses a logged day with more than 20 meals with
  food. That last copy is not on the canvas.
- **Not verified:** nothing run on a device or against staging.
- **Found, not fixed:** `BottomSheet` with `height="content"` never draws
  `title`; PER-132's Your meals sheet passes one. PER-133's short sheets draw
  their own title.

### 2026-11-23 — BE-F1: progress photos and the private media service ([PER-121](https://linear.app/evans-software-solutions/issue/PER-121); branch `bradleysimmsevans/per-121-be-f1-backend-progress-photos-and`)

PR #553 (open, no auto-merge). Linear "Backend design F — Progress photos".
Backend + infra only; no app, native or version change. Unblocks PER-137,
PER-138 and PER-122.

- **Migration** `20261123230832_progress_photos_private_media.sql` (+ rollback):
  `progress_photo_sets` (tombstone `deleted_at`, `updated_at` for `?since=`,
  unique `(user_id, client_request_id)`), `progress_photos` (unique
  `(set_id, pose)`), `private_media` (+ `form_response_id`, set once, and
  `client_request_id`, both beyond the design), `private_media_purges` (purge
  queue, no FK). RLS on, no policies. Drizzle in
  `packages/db/src/progressPhotosSchema.ts`, re-exported by one line at the end
  of `schema.ts`. ⚠ If PER-111's migration merges with a later timestamp,
  rename this one and its references in `progressPhotos.integration` and
  `forms.integration`.
- **Infra** (`infra/storage.ts`, `infra/api.ts`): private `CoachPrivateMedia`
  bucket (SST public-access block, HTTPS-only, explicit SSE-S3 via
  `aws.s3.BucketServerSideEncryptionConfigurationV2`, CORS GET/HEAD/PUT for
  the web origin only; lifecycle: `pending/` expires after 1 day). Linked to
  the API route and the account-purge cron.
- **S3 layer** `application/media/privateMediaStore.ts`: presigned PUTs go to
  the staging key `pending/<key>`, signing content-type and content-length.
  The client uses `requestChecksumCalculation: "WHEN_REQUIRED"` (otherwise an
  empty-body CRC32 is baked into the URL and S3 rejects the real PUT).
  `checkUpload` = HeadObject the staged copy, type/size check, CopyObject to
  the final key, delete the staged copy; no client link can write a final
  key. Views 15 min (owner) / 5 min (coach). The presigner vs client-s3
  `@smithy/types` skew is bridged with a type-only cast.
- **Routes** (`application/media/mediaHandlers.ts`, mounted in
  `coachingRoutes.ts`): `GET/POST /users/me/progress-photos`,
  `POST …/:setId/complete`, `DELETE …/:setId`,
  `GET/POST /users/me/progress-photos/sharing`,
  `GET /trainers/me/clients/:clientId/progress-photos`,
  `POST /users/me/media/uploads` (form_answer: JPEG ≤ 10 MB),
  `GET /users/me/media/:mediaId`, `POST /trainers/me/media/uploads`
  (resource: PDF/JPEG/PNG ≤ 25 MB, design I),
  `GET /trainers/me/clients/:clientId/media/:mediaId`.
  - Create body is `{takenOn, poses:[{pose, bytes, width?, height?}]}`:
    `bytes` is needed to pin the size in a PUT. A replay with the same
    `Idempotency-Key` returns the set with fresh links for poses not yet
    complete (how the phone renews expired links).
- **Consent** (`application/media/photoSharing.ts`): grant rows
  `photo_sharing_prompt` per active non-AI coach; a grant counts only if newer
  than the relationship's `activated_at` and the pair's last `withdraw`.
  `PHOTO_SHARING_COPY` / `PHOTO_SHARING_CONSENT_VERSION` are **placeholders**
  for Brad's wording. `needsPrompt` is true while any active coach lacks a
  grant.
- **Form photo answers** (PER-116's 422 lifted): answer = `{mediaId}` or a bare
  id. `finalisePhotoAnswers` HeadObjects pending uploads before the submit
  transaction; inside it `lockPhotoAnswers` requires own, ready, unattached
  media; `attachPhotoAnswers` sets `form_response_id`. `photo_unavailable` is
  gone (a blank required photo is a normal `required`). Coach view of a photo
  answer: `resolveCoachScope` + the forms' own `visibleRequests` predicate
  (now exported from `requestsRepository.ts`); no photo switch/consent check
  there (decision for Brad).
- **Purge:** `queuePrivateMediaPurge` (before the SQL purge, not swallowed)
  adds the user to `private_media_purges`; `drainPrivateMediaPurges`
  (`media/privateMediaPurge.ts`, nightly) deletes `progress/`, `forms/`,
  `resources/` and their `pending/` copies only once the profile is gone,
  drops the row if the account was restored, keeps it otherwise.
  `AccountRepository.purgeUserData` now returns `boolean`; on `false`
  (restored mid-sweep) the cron counts `restored` and skips the auth-user and
  avatar deletes. That fixes a pre-existing bug: the auth delete cascaded to
  `profiles`. Nightly clean-up: pending sets/media > 2 days and unattached
  form photos > 7 days; rows are deleted first (RETURNING keys), then the
  objects, in one transaction.
- **Tests:** `media/__tests__/` — `progressPhotos.integration` (PGlite, real
  migrations, an in-memory bucket behind a real S3Client: design F tests 1–5,
  two users, two coaches, ended coaching, no consent, switch off, migration
  twice/down/up, the purge cascade), `privateMediaStore`,
  `progressPhotoRepository` (pure), `noAiPhotos` (design F test 6: static
  import closure of every AI module, mutation-checked). Media files 97–100%
  branches. Core `test:unit` 6,283 pass.
- **Inspector Brad on #553: four sweeps, 6 leads, all confirmed and fixed
  with a test that failed first; case closed on 7d1a6ff.**
  - The coach's photo-answer view follows the forms' cycle rule.
  - Uploads are staged under `pending/`, so a late duplicate PUT can't get a
    ready photo expired.
  - Both clean-up sweeps delete rows before objects.
  - The purge queues media and drains only once the profile is gone.
  - An aborted purge skips the auth-user delete.
- **Not verified:** no deploy, no real S3 (presigned PUT, HeadObject,
  CopyObject and the lifecycle untested against AWS), migration not applied
  anywhere, infra files not type-checked locally (`.sst/platform` absent).
