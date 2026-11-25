# Project memory · persistence-backend-sst

### 2026-11-25 — Android push: Firebase config per variant ([PER-149](https://linear.app/evans-software-solutions/issue/PER-149); branch `claude/per-149-android-push`)

Native change approved by Brad on PER-149 (25 Nov). Needs a new Android
build; no build started by an agent. No new package, no Firebase JS SDK.

- `packages/mobile/app.config.ts` sets `android.googleServicesFile` per
  variant: staging → `firebase/google-services.staging.json`; production and
  play-testing (same package) → `firebase/google-services.production.json`;
  dev → none. `GOOGLE_SERVICES_JSON` (EAS file env var) overrides. Files are
  meant to be committed (client identifiers, not secrets); Brad adds them, none
  are in the repo yet.
- Missing file: an Android EAS build (`EAS_BUILD_PLATFORM=android`) throws a
  clear error; everything else (iOS builds, `expo start`, `eas update`, jest)
  only warns.
- Registration path checked: POST_NOTIFICATIONS is in the expo-notifications
  manifest and requested via `requestPermissionsAsync`; the "default" channel
  is created in `app/_layout.tsx` and matches the backend's `channelId`;
  `getExpoPushTokenAsync` passes the EAS projectId; the hook registers with
  `platform: "android"`; the tap handler is platform-neutral. No code fix was
  needed. Not fixed (reported): `addPushTokenListener` registers raw native
  tokens next to Expo tokens (prod: 53 active raw iOS rows).
- Tests: `__tests__/app.config.test.ts` (per-variant file, override, missing
  file warn/throw), Android cases in `usePushNotifications.test.tsx` and
  `expo-notifications.adapter.test.ts`. Brad's steps:
  `docs/android-push-setup.md`.

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
