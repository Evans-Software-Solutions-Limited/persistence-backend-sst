# Project memory · persistence-backend-sst

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

### 2026-11-23 — APP-D1: Log per-meal calories, Your meals, full-page Add to a meal, offline batch logging ([PER-132](https://linear.app/evans-software-solutions/issue/PER-132); branch `bradleysimmsevans/per-132-app-d1-athlete-log-per-meal`)

PR #550 (open, no auto-merge). Mobile only: no backend, migration, native
package, permission or version change. Uses PER-109's merged
`GET/PUT /nutrition/user-meals`, `userMealId` and `POST /nutrition/entries/batch`.
Ships in the next store release, reviewed on staging.

- **Brad's calls (23 Nov, in session):** follow canvas N1 (Log · Plan · Meals
  switch, week strip, compact rings); keep Mealprint and water reachable;
  N1b per the latest comments (no stale "Days on a plan…" subtitle) with the
  ⋯ menu; reorder with the existing drag library
  (`react-native-reanimated-dnd` via `ReorderableList`).
- **Your meals:** `domain/models/userMeals.ts`,
  `domain/services/userMeals.service.ts` (grouping, edits, PUT body, week
  states, recents, Quick log parsing), `application/commands/userMeals.command.ts`.
  Cached in `cached_user_meals` (new table; `getCachedUserMeals` /
  `cacheUserMeals` / `swapLocalUserMealId` on StoragePort; `getUserMeals` on
  ApiPort). Edits are one coalesced `PUT /nutrition/user-meals` (entity
  `user_meals`). A new meal is `local-<key>` + `clientRequestId`; the PUT
  reply swaps the id in the list, cached days and queued entry payloads.
  Before the list is ever fetched, four synthetic `slot:` defaults show and
  editing is disabled (sending them would copy the server's seeded defaults).
  Warmed in `warmOfflineData` unless an edit is queued.
- **Grouping:** same rule as the server's `effectiveUserMeal`: an entry with
  no (or an archived/unknown) `userMealId` sits under its slot's seeded
  default, else the first active meal on that slot; a slot with no meal gets
  its own section. Mealprint ghost rows attach to the slot's default meal.
- **Logging:** `useLogEntry` attaches the open drawer's `userMealId`
  (`useFuelSheets.userMealId`) while the log's `mealSlot` still matches; a
  slot-only log sends no `userMealId` (byte-identical to 1.2.0).
- **Batch replay** (`sync.command.ts`): a queued `POST /nutrition/entries`
  with an idempotency key and no `local-…` reference is sent with every
  other such entry (≤ 50) as one `POST /nutrition/entries/batch`,
  `clientRequestId` = the queue row's key (the same column the single POST's
  `Idempotency-Key` fills), so lost replies, part-sent batches and
  single-then-batch re-sends never duplicate. Per-entry results; a per-entry
  error is permanent unless the body still holds a local id (deferred). A
  whole-batch 402 blocks; a permanent 4xx (e.g. no route) falls back to keyed
  single sends; transport errors defer. Entries a batch handled are skipped
  for the rest of that drain (found by a test: a deferred entry was being
  re-sent in the same pass).
- **Screens:** `FuelPresenter` (N1) = `presenters/fuel/FuelLogHeaderPresenter`
  + `FuelLogSummaryPresenter` + `FuelQuickActionsPresenter` +
  `MealLogPresenter` (shipped rows; per-meal kcal + "Cg C · Fg F · Pg P",
  ⋯, "Add or edit meals"). Full page `/(app)/fuel/add-to-meal?meal=&tab=`
  (`AddToMealContainer`). Root drawers: `YourMealsSheetContainer`,
  `MealOptionsSheetContainer`, `QuickLogSheetContainer`,
  `SuggestLockedSheetContainer`. Snap uses `ImagePicker.launchCameraAsync`.
  Plan tab → Mealprint day plan (or the locked page) until PER-133; Meals tab
  → recipes library. The Mealprint entry card, macro hero and 4-button row
  are no longer rendered (`MacroHeroPresenter`, `QuickAddRowPresenter`,
  `MealprintEntryCard` component left in place).
- **Not on the canvas (flagged in the PR):** "Connect to the internet once to
  edit your meals."; Add to a meal empty states; new meals map to the old
  `snack` slot; the target cell says "Target" (no plan name); the
  "This week's nutrition" button is a calendar button; Quick log has no
  label-photo line (N2d undecided); Clear has no confirm (like swipe delete).
- **Tests:** service, command, real-SQLite storage, batch replay against a
  fake idempotent server (offline log, one-call replay, lost reply, single
  then batch, cap, meal-then-entries, per-entry error, fallbacks, 402, 5xx),
  presenters, containers, the locked Suggest state and 1.2.0 grouping.
- **Not verified:** nothing run on a device or against staging.

- **Inspector Brad on #550, eight sweeps, 13 leads, all confirmed and fixed;
  case closed on 7e0e609:**
  - A Your-meals read no longer beats a live or just-acknowledged edit
    (`preserveConcurrentCacheWrites` + `pendingWrites` + `reconcile`), and a
    dead PUT (permanently failed / exhausted) no longer blocks reads
    (`liveUserMealEdits`, `isAutoResolvableSyncEntry`). The sign-in warm-up
    snapshots the cache and skips its write if an edit landed meanwhile.
  - The PUT reply swaps `local-<clientRequestId>` from the server's answer,
    not the cache. `logEntryCommand` resolves a stale `local-…` id to the
    synced meal, and `findUserMeal` follows `local-…` and `slot:` ids on every
    screen (Add to a meal, Quick log, ⋯ menu).
  - A batch that 5xxs again (any entry already retried) falls back to keyed
    single sends, so one bad entry can't fail 50.
  - A sheet handoff (Quick add → Scan/Snap) keeps the meal unless the slot
    changes.
  - Save as a meal counts only rows on screen; the ⋯ menu passes food and
    recipe entries only.
  - A newer list drops dead older PUTs for the user, carrying forward any
    meals they added offline (capped at 30), so their food logs still sync.
