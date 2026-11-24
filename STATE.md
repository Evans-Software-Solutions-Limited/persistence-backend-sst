# Project memory · persistence-backend-sst

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

### 2026-11-23 — BE-G1a: different reps for each set ([PER-111](https://linear.app/evans-software-solutions/issue/PER-111); branch `bradleysimmsevans/per-111-be-g1a-backend-different-reps-for`)

PR #552 (open, no auto-merge). Backend only: design G part 1. No mobile,
web, native or version change. Unblocks PER-139 (APP-G1); PER-112 (BE-G1b)
starts after this merges and adds the rest of migration 9.

- **Migration** `supabase/migrations/20261123230809_workout_exercise_set_targets.sql`
  (+ rollback): `workout_exercise_set_targets` (workout_exercise_id → CASCADE,
  set_number 1–20, target_reps 1–100, unique per set, RLS on, no policies).
  Mirrored as `workoutExerciseSetTargets` in `packages/db/src/schema.ts`
  (inserted after `workoutExercises`; import block untouched).
- **API (additive):** `setTargets?: [{reps}] | null` on each exercise of
  `POST /workouts`, `PATCH /workouts/:id` and the Loadout variation bodies
  (shared `workoutExerciseInputSchema`), and on Together template plans.
  Every workout read (`GET /workouts`, `/workouts/:id`, bootstrap, variation
  201, Loadout preview rows) returns `setTargets` per exercise, **omitted**
  when there are none. Shared rules in `workouts/shared/setTargets.ts`.
- **Old columns:** whenever set targets are written, `target_sets` /
  `target_reps_min` / `target_reps_max` = count / lowest / highest
  (`withDerivedTargets`), whatever the client sent; the duration estimate
  uses them too. 10/8/8 reads as 3 × 8–10 on 1.2.0.
- **Preservation rule** (`preservedSetTargets`): an update exercise sent
  without `setTargets` keeps the stored rows when same `exercise_id` + `sort_order`
  and the sent sets/range equal the derived values; otherwise they're
  dropped. `null` drops them explicitly. 1.2.0 sends no `exercises` on a
  rename and the full 7-field list on a plan edit (recorded in
  `workouts/__tests__/fixtures/workouts120.fixture.ts` from c1bf892).
- **Reads:** one correlated `json_agg` subquery (`setTargetsJson`) on the
  existing selects. ⚠ Its columns are qualified by hand: Drizzle renders
  `${workoutExercises.id}` as a bare `"id"` in a single-table select, which
  inside the subquery silently matched the set-target row itself (found by
  the PGlite test; mocked unit tests can't see it).
- **Copy paths** (everything that writes `workout_exercises`): workout create,
  update (delete + reinsert, preserved), Loadout `createVariation` /
  `replaceVariation` (parent's rows carried to kept and swapped rows by the
  same rule, matching a swap on `substitutedFromExerciseId`; preview carries
  them through the engine), Together template create/read/copy. Programme
  assignment, programme reads, the active programme and design A's copy-setup
  only reference workouts by id, so assigned clients get `setTargets` through
  `GET /workouts/:id` and `?type=assigned` (tested). No backend Duplicate
  endpoint exists (the app duplicates via `POST /workouts`).
- **Tests:** `workouts/__tests__/designG.setTargets.integration.test.ts`
  (PGlite + shipped migration: forward twice / down / up, CHECKs, cascade,
  round-trips, preservation cases, 1.2.0 fixture, assignment read, two-user
  isolation, variation carry), template tests in
  `social/__tests__/social.integration.test.ts`, unit tests for the rules and
  the Loadout engine carry.
- **Verified:** prettier:check, typecheck, lint, build; core `test:unit`
  430 files / 6,242 tests pass, coverage 98.5 / 94.8 / 98.3 / 98.5;
  `workoutRepository.ts` 97.4 / 94.9 / 96.4 (stmts / branches / funcs).
  Mobile/web suites not run (untouched).
- **Not verified:** nothing run against staging or a device; the 1.2.0
  bundle itself wasn't run (contract held via the recorded fixture).
- **Inspector Brad (#552):** 1 sweep, 0 findings, case closed on 1b5fec1.
  Its only note: copies assume `INSERT … RETURNING` returns rows in VALUES
  order (true in practice, not formally promised; documented in code).
