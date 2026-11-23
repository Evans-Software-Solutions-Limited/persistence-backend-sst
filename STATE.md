# Project memory · persistence-backend-sst

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

### 2026-11-23 — BE-C2: coach events, Today, notifications, quiet hours and the 15-minute scheduler ([PER-117](https://linear.app/evans-software-solutions/issue/PER-117); branch `bradleysimmsevans/per-117-be-c2-backend-coach-events-today`)

PR #548 (open, no auto-merge). Linear "Backend design C", D2 (scheduler) and
D4; covers PER-93 (coach notification settings). Backend only; no app UI or native change. Ships in the
next store release, reviewed on staging.

- **Migration** `20261123120117_coach_events_notifications.sql` (+ rollback):
  `coach_events` (unique `(trainer_id, dedupe_key)`; `kind` validated in code;
  `push_state` none/pending/held/sent/skipped; `updated_at` for `?since=`),
  `coach_notification_settings` (trainer PK, `channels` jsonb, quiet hours,
  revision), `coach_scheduler_runs` (claims, PK `(job, run_key)`),
  `notification_type` += `coach_event`, `form_request`, `form_reminder`.
  RLS on, no policies. **No existing table or column changes.** ⚠ Migrate
  before deploy: accept, form responses and finished workouts now write
  `coach_events` (the session hook swallows errors; accept and form submit
  would 500 without the table).
- **Events** (`coaching/events/`): `recordCoachEvent` decides the push at
  write time: client muted → `skipped`; `everything` → push every kind;
  else the coach's channel or the default (`workout_completed` defaults to
  in-app only, the rest push); quiet hours (coach's `profiles.timezone`,
  wraps midnight) → `held`. `deliverCoachEvents` claims `pending → sent`
  before pushing. Coach pushes are `coach_event` rows in the coach's own inbox
  with deep link `persistencemobile://clients` (1.2.0 routes it).
- **Writers, one call each in existing paths:** `PATCH /sessions/:id` →
  completed and `POST /sessions/record` (not replays/cancelled) call
  `safeRecordWorkoutCompleted` after commit: one `workout_completed` per active
  coach (rating 1–5, difficulty 1–10, note), plus `record_hit` when the
  session's sets hold current PRs; skipped for workouts before that coach's
  `activated_at`. `submitResponse` → `form_completed` / `check_in_completed`
  (weekly/daily), pushed after commit. `acceptPersonalCode` →
  `client_accepted` with **no push** (the accept handler already pushes
  "Client accepted"); `trainersRespondToRequestHandler` → `client_accepted`
  (pushed by the next tick). Scheduler: `form_missed`, `invite_expired`
  (personal code past `expires_at`, profile still invited),
  `programme_ending` (assignment `end_date` within 7 days, assigned by an
  active coach; dateless programmes never raise it), `training_behind`
  (`computeAdherence`, full 7-day window only, at most once per client per 7
  days). No response shape changed.
- **Scheduler** `coachSchedulerCron` (`infra/api.ts`, `rate(15 minutes)`,
  300 s timeout, error + heartbeat alarms in `infra/monitoring.ts`) →
  `coaching/scheduler/coachScheduler.ts`. Each job claims `(job, slot)`
  (daily jobs: UTC date, from 08:00 UTC) and stamps `finished_at` when done;
  a failed job gives its claim back and the cron throws so the alarm fires;
  an unfinished claim older than 10 min (a run killed at the Lambda timeout)
  is taken over. Every job pages through all its rows (keyset), so nothing
  past a page is skipped; sizes in `scheduler/jobs/pageSizes.ts`. Jobs (`scheduler/jobs/index.ts`):
  `form_periods` (weekly/daily in the athlete's zone, first tick at or after
  the time, within 6 h, never before the client's `activated_at` or the rule's
  `created_at`; a new period marks the previous pending one missed),
  `missed_forms`, `form_pushes` (announce each new request once — any trigger,
  so on_join/once/on_end forms get a push too, up to 15 min late — and
  reminders via `reminders_sent`, one push per tick, none while the rule or
  client is paused), `invite_expiry`, `programme_ending` (daily),
  `training_behind` (daily), `coach_pushes` (pending sweep after 1 min; quiet
  release, one push per client, "Sam: 3 updates"). Bounded (500–2000 rows per
  job). **PER-120 / PER-123 register a job by adding it to that array.**
- **Generators:** `insertRequests`, `liveVersions`, `scheduleTargets` in
  `forms/generators.ts` are now exported; the trigger type gained
  weekly/daily. Nothing else in BE-C1 changed.
- **Routes** (`coaching/events/coachNotificationsHandlers.ts`, mounted in
  `coachingRoutes`, trainer role): `GET /trainers/me/notifications`
  (`kind`, `clientId` via `resolveCoachScope`, `since` → changes +
  `deletedIds`, keyset `cursor`, `limit` ≤ 200, `unreadCount`, `asOf`),
  `POST …/notifications/read` (`{ids}` | `{all}`), `GET /trainers/me/today`
  (`queue` of actionable unactioned kinds with `action`, `counts`,
  `schedule: []` for design I, `strip` = practice `adherenceByArea`),
  `POST /trainers/me/today/:eventId/actioned` (also marks read; idempotent),
  `GET/PUT /trainers/me/notification-settings` (`emailAvailable: false`,
  channels merge, `expectedRevision` → 409 `revision_conflict`). Events for a
  relationship that is no longer active are hidden (exit-form responses
  stay). `/notifications/preferences` unchanged.
- **1.2.0 (D5) checked, no fallback needed:** the 1.2.0 bundle (3bad31e) has
  the same `mapApiNotification`, `NotificationRow`, model and deep-link
  resolver as main: unknown types parse, render with the generic bell row,
  and tap to Home (athlete rows carry no deep link) or Clients (coach rows).
  Proven by `packages/mobile/src/adapters/api/__tests__/coachNotificationTypes.test.tsx`.
  The new types are NOT in `NOTIFICATION_TYPES` (the preferences list).
- **Tests:** `coaching/events/__tests__/coachEvents.integration.test.ts`
  (PGlite, real migrations and handlers): D7.2 (weekly Sunday 18:00 London/NY
  over both clock changes; daily 00:30 on each clock-change night; per-client
  time/weekday), D7.3 (announce once, reminders at most N, burst → one,
  paused client/rule, stop, completed, missed once, overlapping runs), D7.7
  (one event per coach with rating/note, records, replay dedupe, mute,
  everything, quiet hold/release in London and NY, pending sweep, form
  events, accept), D7.9 (preferences keys = 1.2.0 fixture; `GET /notifications`
  rows), two-coach isolation, feed/Today/settings, scheduler claims, migration
  forward twice / down / up. `scheduler/__tests__/zonedTime.test.ts` (gap and
  repeated hours, ISO weeks). PER-108/PER-116 suites now apply this migration;
  session and respond handler unit tests mock the new writers.
- **Inspector Brad on #548: five sweeps, 13 leads, all confirmed and fixed
  with a test that failed on the previous commit; case closed on `701b31e`:**
  - Training behind judged a barely-started "today" → judged on the 7
    complete days ending yesterday in the client's zone.
  - Reminder page filled by rows not yet due → due-count filter in SQL.
  - Missed-marking skipped after a failed run / committed without its event →
    runs every tick for the latest period, in one transaction with its events.
  - Missed exit form pushed but hidden → visible in the feed; Today keeps
    answered exit forms (review) and leaves out missed ones (no nudge).
  - Pending sweep ignored quiet hours begun since the write → held.
  - Fixed caps skipped rows past them (rules, behind coaches, held release,
    invite expiry, programmes ending) → every job pages through all rows.
  - A run killed at the Lambda timeout kept its claim → `finished_at` and
    claim takeover after 10 min.
- **Not verified:** nothing applied to staging; no deploy; no device run;
  real Postgres concurrency (PGlite is one connection).
