# Project memory · persistence-backend-sst

### 2026-11-24 — Web: Oxlint type-aware promise rules on, 87 findings fixed ([PER-148](https://linear.app/evans-software-solutions/issue/PER-148) follow-up; branch `claude/laughing-wright-8f5buu`, stacked on `claude/brave-dirac-h9ianz`)

Brings `packages/web` up to the backend packages' lint bar. No UI output or
copy change; the only behaviour change is the admin guard fix below.

- **Config:** `packages/web/.oxlintrc.json` sets `options.typeAware`, adds
  `typescript` to the ROOT `plugins` list, and makes
  `typescript/no-floating-promises`, `no-misused-promises` and `await-thenable`
  root errors. Verified with a scratch file holding an unawaited async call
  (also under `src/components/ui/**`, whose override names only `react`):
  flagged with `typescript` in root `plugins`, silently 0 findings without it.
- **Fixes (63 src, 24 tests), no rule disabled:**
  - `navigate()` (react-router's `NavigateFunction` returns
    `void | Promise<void>`) and `query.refetch()` (never rejects) → `void`.
    FormsLibrary's `go`/`close` helpers now return `void`.
  - Async JSX handlers → `onX={() => void handler()}`. Long inline bodies were
    moved unchanged into named component functions (`endCoaching`,
    `copySetup`, `copyTemplate`, `copyLink`, `sendLink`, `promptExtend`,
    `promptRevoke`, `promptAttribution`, …). In `InvitedClientContainer` they
    are `const` arrows so the `detail` narrowing still applies.
  - Every voided call already handles its own errors (try/catch in the
    handler, `useLeadSubmit`, coach `getAccessToken`/`signOut`, the admin
    prompt/confirm dialogs). The CSV `file.text()` uses `.then(setCsv, setError)`.
  - **Real gap fixed:** `admin/RequireAdmin` awaited `getAccessToken()`, whose
    refresh `fetch` can reject offline; that left the guard stuck on
    "Checking" with an unhandled rejection. A rejection now counts as no
    session (→ `/admin/login`).
  - Tests: fetch mocks typed `Mock<Fetcher>` (the string-body/plain-header
    shape the code sends) instead of `ReturnType<typeof vi.fn>`, which is
    void-returning; `act(() => { vi.advanceTimersByTime(n); })` blocks;
    `void navigate()` in test helpers.
- Oddity: tsrs did not flag `getAccessToken().catch(...).then(fn)` inside a
  `useEffect` though it flags the same chain in a plain function; it is
  `void`ed explicitly anyway.
- **Verified:** `bun run prettier:check`, `bun run lint`, `bun run typecheck`
  (all uncached, pass); web `test:unit` 99 files / 1978 tests pass, coverage
  97.18 / 92.83 / 96.97 / 97.88 (statements/branches/functions/lines;
  baseline 97.18 / 92.81 / 96.99 / 97.89).
- **Not done:** `packages/mobile` (~71 src + ~193 test findings) is a separate
  task because of the legacy-fidelity rule.

### 2026-11-24 — Tooling: TypeScript 7 + Oxlint with tsrs type-aware linting ([PER-148](https://linear.app/evans-software-solutions/issue/PER-148); branch `claude/brave-dirac-h9ianz`)

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
- **Type-aware (tsrs):** core, other-service, api-utils and seed set
  `options.typeAware` with `no-floating-promises`, `no-misused-promises` and
  `await-thenable` as errors. All four were already clean apart from two
  `await-thenable` cases in `progressPhotos.integration.test.ts` (narrowing of
  a callback-assigned `let`; now restated). Web (~87) and mobile (~264)
  findings are a follow-up, so those two configs match their old ESLint rules.
  Gotcha: root `typescript/*` rules are silently ignored unless `typescript`
  is in the root `plugins` list.
- Oxlint also found 3 `no-unsafe-optional-chaining` cases ESLint missed (core
  `sessionRepository.test.ts`, web `coach/__tests__/api.test.ts`), now fixed,
  and 7 non-blocking `import/no-named-as-default-member` warnings in mobile.
- **Measured** (4 cores, `--force --concurrency=1`): typecheck 79s → 17s,
  lint 63s → 5s; mobile typecheck 21.5s → 2.8s; core lint 9.8s → 0.1s
  (1.7s type-aware). Build 30s, passes.
- **Verified:** prettier, typecheck, lint, build (all packages, uncached).
  Unit tests: see below.

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
