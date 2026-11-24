# Project memory · persistence-backend-sst

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

### 2026-11-23 — APP-A3: athlete invite preview and accept, Coach tab chips, You → Coaching ([PER-126](https://linear.app/evans-software-solutions/issue/PER-126); branch `bradleysimmsevans/per-126-app-a3-athlete-invite-preview-and`)

Mobile only, no backend change, no native change, no version bump. Uses the
merged BE-A1 routes (PER-108, #540): `GET /invites/:code/preview`,
`POST /trainers/accept-invite-code` (`relationshipStatus`, `ready`) and
`GET /users/me/coaching`. Ships in the next store release, reviewed on staging.

- **Accept flow** (`AcceptInviteContainer`): enter code → preview (C11j,
  `InvitePreviewPresenter`) → one consent tick → accept. Personal code
  (`relationshipStatus: "active"`) refreshes `cached_my_coaches`, lands on the
  Coach tab and says "You're connected with <coach>". General code, or an
  older backend without the field, keeps "Request sent … awaiting their
  acceptance". The old `DataSharingConsentSheet` step is gone from this flow
  (still used by Requests).
- **Consent (Brad, 23 Nov):** the C11j "<coach> can see" rows are a fixed,
  read-only list (backend stores one consent, not per-area choices); a
  never-pre-ticked "I agree" tick gates Accept.
- **States:** invalid/expired (404 `invalid_code`; the backend doesn't tell
  them apart, so one message), expired while open (client clock vs
  `expiresAt`), seat cap (409), already connected, used, rate limited (429,
  new `rate_limited` accept code), offline before lookup and before accept.
- **Coach tab** (`app/(app)/(tabs)/coach.tsx`, `CoachTabContainer` /
  `CoachTabPresenter`): athlete mode only, only while `coaches.length > 0`
  (`_layout.tsx`, `athleteTabsWithCoach`). Chips only with 2+ coaches (Brad).
  Badge = sum of `due.forms`. C2e sections (forms PER-130, messages PER-92,
  plan PER-140/133, resources PER-122) render as dashed "In development"
  placeholders (Brad: release waits for the whole platform). No message button
  until chat ships. The stranded-route guard sends the athlete Home when the
  last coach goes.
- **Offline:** new SQLite table `cached_my_coaches` (one JSON payload per
  user, in the init DDL, cleared in `clearAll`), `useMyCoaches`
  (`useCachedResource`, `MY_COACHES_TABLES`). Leaving a coach (Profile)
  calls `storage.removeCachedMyCoach`, so the chip/tab go at once. No queued
  entity types: accepting is online only.
- **You → Coaching (Y1):** reads `useMyCoaches`; falls back to active
  relationships until the first read. Row tap → Coach tab on that coach.
  Coach requests stay under the list (Brad, 23 Nov).
- **Verified:** mobile typecheck, lint, repo prettier:check, `bun run build`.
  Mobile `test:unit`: 9,167 pass, coverage 96.3 / 92.3 / 96.2 / 97.6
  (stmts/branches/funcs/lines). 32 failures in 3 suites, none touched here:
  `SubscriptionSelectionContainer` fails on main too (16 alone);
  `CoachYouContainer` and `useAutoRetryOnWorkoutLimitResolved` pass alone
  (load timeouts in the full run).
- **Not verified:** no device or staging run; canvas match checked against
  board markup only.
- **Inspector Brad (#547):** 4 sweeps, 5 leads fixed with failing-first tests,
  closed clean on 8cfae9f.
  - Every `useMyCoaches` re-reads the cache synchronously on write
    (`notifyMyCoachesChanged`), so the Coach tab exists before the accept
    navigates; the storage bus alone is debounced.
  - The accept opens `coach?coachId=<new>&nav=…` only when the coach is cached
    and the app is in athlete mode, otherwise You.
  - Accept stays disabled while the coach loads.
  - The chip override is keyed on `coachId|nav`.
  - You rows aren't tappable until coaching has been read.

### 2026-11-23 — APP-A1: web coach workspace, add client (C11), invited client, C3.9 settings ([PER-124](https://linear.app/evans-software-solutions/issue/PER-124); branch `bradleysimmsevans/per-124-app-a1-web-coach-add-client-c11`)

`packages/web` only; no backend, mobile, native or migration change. Uses the
PER-108 routes as merged (plus PER-116 forms and PER-118 meal plans for the
set-up sections). Ships with the next store release window; Brad reviews on
staging.

- **New web coach workspace** at `/coach/*` (`src/coach/`, lazy-loaded as its
  own chunk, not linked from the marketing site). Brad, 23 Nov: build the
  shell properly in this ticket, because `packages/web` had no coach sign-in,
  rail, Clients list or client page.
  - Sign-in: GoTrue magic link (`create_user: false`), session in
    `localStorage` (`persistence.coach.session`), refresh near expiry, kept
    while offline. Reuses `admin/adminAuth.ts`'s JWT decode + Supabase config.
    ⚠ Supabase's redirect allow-list needs `https://<site>/coach/callback`
    for staging and production (dashboard setting, not in the repo).
  - Role gate is UX only (`GET /profile` role in personal_trainer /
    physiotherapist / admin); the API enforces it on every call.
  - Rail (K layout): Today, Notifications, Library, Messages and You are shown
    but inert ("Not on the web yet"); Clients is live.
- **Screens** (container/presenter): Clients list (C11e: Invited above
  Active, Resend; Active keeps client / programme / last active, the C8
  Check-in and Adherence columns are PER-129 / PER-127), Add client 1 Who /
  2 Set up / 3 Invite (C11a–c), Preview as client (C11b2), Copy setup from a
  client, invited client page (C11d: only Overview open, other tabs locked,
  Copy link, Resend, Cancel invite, private notes), active client page with
  the C3.9 Settings tab.
- **Set-up sections shown**: starter forms, repeating check-ins, calorie and
  macro target, meal plan, welcome message (`WEB_SECTIONS` in
  `coach/lib/setup.ts`). Programme (PER-112) and resources (PER-122) have no
  live handler and no web editor; a section answering 422
  `section_unavailable` is hidden at run time. Moving to another section,
  Back, Skip and Next save (PUT with `expectedRevision`); Cancel drops the
  current section's draft. A repeating check-in's day/time/due/reminders are
  saved as the per-client `override`; "How often" comes from the send rule
  and is read-only here.
- **Coach declaration**: asked before the first personal invite (GET status,
  then a dialog; a 403 `declaration_required` also opens it). The canvas has
  no declaration copy, so Brad asked for researched standard wording:
  `coach/lib/declaration.ts` (DRAFT, version `2026-11-v1`, SHA-256 of the text
  sent as `statementTextHash`). Changing the text needs the version bumped
  here and in `COACH_DECLARATION_VERSION`.
- **C3.9 settings** (Brad's choice): the six backend feature keys (Meal plans
  + Food logging shown as one "Nutrition" row; Training plan, Workout logging
  and AI summary rows hidden, no key), plus "Tracked for {name}": Training
  with a sessions-per-week stepper (1–14, starts at 3) and Calories. Alerts
  as three exclusive switches. End coaching = `DELETE
  /trainers/me/clients/:clientId`. The board's "{name} shares with you" and
  "Coaching" details are hidden: no coach-side API for them.
- **States**: offline (C9c banner "Offline · showing X as of HH:MM", edits
  and online-only actions disabled; queries use `networkMode: "always"` so a
  page opened offline says so instead of loading for ever), 409
  `revision_conflict` on profile, set-up and settings (server copy replaces
  ours, "Updated on another device"), expired code ("Code expired" pill,
  Resend). Resend only issues a new code (the backend sends nothing), so it
  opens the invite step to share it.
- **Copy**: the canvas uses she/her for Lena; the web never knows pronouns,
  so copy uses the first name or they/their.
- **New dependency**: `qrcode` (+ `@types/qrcode`), web only, for the invite
  QR (encodes the same `persistencemobile://accept-invite?code=` link as the
  iPhone sheet). `bun.lock` re-hoisted some vitest coverage entries (same
  versions).
- **Tests**: `src/coach/__tests__/` (118): pure libs, auth/API client, and
  every container through a fake API (`CoachApiContext`): save-on-move,
  Cancel, 409 on each write, section_unavailable, offline per screen,
  expired code, declaration gate, copy-from, preview, end coaching. After
  the review: 151 tests in `src/coach`.
- **Not verified**: no staging run, no real Supabase sign-in, nothing against
  the live API (fake API + Playwright render with mocked routes only).
- **Inspector Brad on #549: thirteen sweeps, every lead confirmed and fixed
  with a test that fails on the previous commit; case closed on `222ffc7`.**
  - Auth: a failed refresh (network, 5xx, 429, timeout) keeps the session;
    only a rejected refresh token signs out (`refreshSession` → ok /
    rejected / unavailable, 10 s timeout). A 401 tries the stored token, then
    one shared refresh, then retries; a 401 on a just-issued token is a
    retryable 503 `auth_unavailable`, not a sign-out. Refreshes are shared
    per refresh token in the tab and never write back after Sign out.
    `endSession()` + `onSignedOut` send the layout to sign-in. Sign out uses
    `/logout?scope=local` (global also signed the coach out of the phone).
  - `/coach` is mounted outside the marketing tree in `App.tsx` (no pixel,
    Tradedoubler, page view or cookie banner while the callback URL holds
    tokens).
  - Revisions: Who, set-up drafts and notes keep the baseline they started
    from (no silent overwrite after a focus refetch); a 409 caused by an
    unrelated change resends once when what the coach edited is unchanged
    (also C3.9 settings), never into a profile the client has accepted, and
    the cache keeps the 409's newer copy. Other drafts follow the coach's own
    saves and copy-from. Leaving set-up any way saves (the title link via
    `go()`, anything else in the background on unmount); screens remount per
    profile id (`PerProfile`).
  - The invite step only auto-issues after a successful fresh read (a code
    issued on another device is never voided).
  - Not changed (outside the ticket, flagged to Brad): `admin/adminAuth.ts`
    Sign out also uses GoTrue's default global scope.
