# 24 — Coach Authoring & Library IA: Design

> Companion to `requirements.md`. Grounded in code read on 2026-07-17 (file:line
> citations below were accurate at `origin/main` = `0c4aad8`).

---

## Decision record

Three decisions Brad signed off (2026-07-17) before this spec was authored:

1. **Exercise visibility → assignment-scoped (backend change).** The blanket
   "athlete sees every exercise authored by any linked coach" branch is
   **replaced** by an assignment-scoped predicate. Chosen over "keep
   all-or-nothing" and over "hide-from-search-only". Rationale: it matches Brad's
   requirement exactly, needs no new share table, and is a pure query change.
2. **Remove the You-tab "Workout library" card.** Programs → Workouts is the
   single canonical entry.
3. **Defer client discoverability** ("From my coach" filter). Assigned coach
   exercises surface through the assigned programme/workout views.

---

## Part A — Backend: assignment-scoped exercise visibility

### A.1 What exists today

`microservices/core/src/application/repositories/exerciseRepository.ts:189-204`:

```ts
private buildVisibilityCondition(userId: string | null): SQL {
  const systemClause = or(
    eq(exercises.createdBy, SYSTEM_USER_ID),
    isNull(exercises.createdBy),
  ) as SQL;
  if (!userId) return systemClause;
  return or(
    systemClause,
    eq(exercises.createdBy, userId),
    inArray(exercises.createdBy, this.activeTrainerIdsSubquery(userId)), // ← blanket coach branch
  ) as SQL;
}
```

Applied on every `list()`, `count()`, `search()` (via
`buildNonSearchFilterConditions:286`) and `getById()` (`:502-513`). The blanket
branch (`created_by IN (all linked active non-AI PTs)`) is what leaks a coach's
entire private catalogue into the athlete's library search.

Key facts that make the narrowing safe (verified 2026-07-17):

- **Assigned-workout rendering does not depend on this predicate.**
  `workoutRepository.fetchExercisesForWorkouts` (`workoutRepository.ts:594-638`)
  `leftJoin`s `exercises` with **no** visibility filter, and `canRead`
  (`:516-581`) grants workout access when an assignment row exists. So a client
  opening an assigned workout still sees the embedded exercise fields regardless
  of this change (AC 3.4).
- **`GET /exercises/:id` does apply the predicate** (`getById` → 404 when not
  visible). So the predicate must grant assigned exercises to avoid a 404
  regression on full-detail reads (AC 3.3). This change _resolves_ the current
  embed-vs-getById inconsistency (before: embed shows any workout exercise but
  getById only grants blanket-linked-coach ones; after: both are
  assignment-scoped).
- **Assignment model** (`specs/19-programs`): assigning a programme inserts one
  `program_assignments` row (live = `status IN ('assigned','started')`,
  `LIVE_ASSIGNMENT_STATUSES` in `programRepository.ts:16`) and **materialises**
  `workout_assignments` occurrence rows. Finite programmes materialise fully;
  **indefinite** programmes keep a rolling horizon (topped up on client reads) —
  so materialised occurrences alone do NOT cover all future weeks (AC 3.6).
  Ad-hoc single-workout assignment writes a `workout_assignments` row with
  `program_assignment_id IS NULL`.

### A.2 The visibility predicate (new)

Replace the blanket coach branch with **two** assignment-scoped subqueries
OR'd into the predicate. Keep system + own branches unchanged.

```ts
// NEW: exercises reachable via a LIVE programme assigned to the client.
// Keys off the programme DEFINITION (program_workouts) so ALL weeks are
// covered, including not-yet-materialised occurrences of indefinite
// programmes (AC 3.6).
private programmeAssignedExerciseIdsSubquery(userId: string) {
  return getDb()
    .select({ exerciseId: workoutExercises.exerciseId })
    .from(workoutExercises)
    .innerJoin(
      programWorkouts,
      eq(programWorkouts.workoutId, workoutExercises.workoutId),
    )
    .innerJoin(
      programAssignments,
      eq(programAssignments.programId, programWorkouts.programId),
    )
    .where(
      and(
        eq(programAssignments.clientId, userId),
        inArray(programAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
      ),
    );
}

// NEW: exercises reachable via a workout assigned to the client — ad-hoc
// assignment, OR a materialised/past programme occurrence. ANY status, so an
// exercise the client actually trained stays readable in history even after
// the programme is completed/unassigned (no getById 404 regression).
private assignedWorkoutExerciseIdsSubquery(userId: string) {
  return getDb()
    .select({ exerciseId: workoutExercises.exerciseId })
    .from(workoutExercises)
    .innerJoin(
      workoutAssignments,
      eq(workoutAssignments.workoutId, workoutExercises.workoutId),
    )
    .where(eq(workoutAssignments.clientId, userId));
}

private buildVisibilityCondition(userId: string | null): SQL {
  const systemClause = or(
    eq(exercises.createdBy, SYSTEM_USER_ID),
    isNull(exercises.createdBy),
  ) as SQL;
  if (!userId) return systemClause;
  return or(
    systemClause,
    eq(exercises.createdBy, userId),
    inArray(exercises.id, this.programmeAssignedExerciseIdsSubquery(userId)),
    inArray(exercises.id, this.assignedWorkoutExerciseIdsSubquery(userId)),
  ) as SQL;
}
```

**Why two branches** (not one):

- The **programme** branch keys off `program_assignments` + `program_workouts`
  (the definition), so it covers every week of an assigned programme regardless
  of horizon materialisation (AC 3.6). Scoped to **live** statuses so a
  completed/unassigned programme's _future-only_ exercises stop appearing in
  search (Brad's intent).
- The **workout-assignment** branch keys off `workout_assignments` (any status),
  covering ad-hoc single-workout assignments AND surviving occurrences of a past
  programme (the ones the client actually engaged with are not deleted on
  unassign) — so exercises the client trained stay readable in history.

Net set an athlete sees: `system ∪ own ∪ (exercises in a live-assigned
programme) ∪ (exercises in any assigned/materialised workout)`. Never-assigned
coach customs are excluded (AC 3.1/3.7).

### A.3 Interaction with the `created_by=pt` filter

`buildCreatedByFilterCondition` (`:222-268`) keeps using `activeTrainerIdsSubquery`
for the `"pt"` value — **unchanged**. Because that filter narrows _within the
visible set_ and the visible set no longer includes unassigned coach exercises,
`created_by=pt` now returns only assigned coach exercises. Consistent; the mobile
UI does not expose `pt` anyway (only `mine`/`system`). `activeTrainerIdsSubquery`
is retained (still referenced here).

### A.4 Imports & cycles

`exerciseRepository.ts` gains imports from `@persistence/db`: `workoutExercises`,
`workoutAssignments`, `programWorkouts`, `programAssignments`. Import
`LIVE_ASSIGNMENT_STATUSES` from `programRepository`; if that introduces an import
cycle (verify at build), inline `["assigned","started"] as const` with a comment
pointing at `programRepository.ts:16` as the source of truth.

### A.5 Performance

The predicate runs on every list/search/count/getById. The two subqueries are
**client-scoped** semi-joins (`inArray(exercises.id, subquery)` → Postgres
hashed semi-join). Indexes in play: `program_assignments (client_id,status)`
(`schema.ts:1071`), `workout_assignments (client_id,due_date)` (`schema.ts:985`).
Confirm `workout_exercises(workout_id)` and `program_workouts(workout_id)` are
indexed; the FK columns usually are, but **verify and add an index if missing**
(note in tasks). A browse already scans most of the ~2.3k-row system catalogue
via the system branch, so the subqueries add only client-proportional work — not
a regression for typical use.

### A.6 Backend test strategy

The `exerciseRepository` unit suite **mocks `getDb` and stubs the drizzle
helpers** (`exerciseRepository.test.ts:4-23`) — so SQL is never executed and a
bad join ships green (the `reference_drizzle_groupby_param_bug` blind spot). Guard
in three layers:

1. **PgDialect SQL-shape test (primary guard).** Add a test that builds the real
   list query for an authed user and renders it via `PgDialect().sqlToQuery(...)`
   (pattern already used in `workoutRepository.test.ts` et al.), asserting the
   rendered SQL:
   - joins `program_workouts` + `program_assignments` and filters
     `program_assignments.client_id = $` and `status in ('assigned','started')`;
   - joins `workout_assignments` and filters `workout_assignments.client_id = $`;
   - references `workout_exercises.exercise_id`;
   - no longer contains the blanket `exercises.created_by in (…pt_client…)` as a
     _visibility_ branch (it may still appear under the `created_by=pt` filter
     test, which is separate).
2. **Updated call-shape unit tests.** The authed-visibility tests
   (`list` L93, `search` L853, `getById` L462, `count` L436) assert
   `mockDb.select` call counts; the count changes (the pt-subquery select in the
   visibility path is replaced by two assignment-subquery selects). Update the
   universal mock chain to satisfy the new `.innerJoin().innerJoin().where()` /
   `.innerJoin().where()` shapes and the expected counts. Add explicit assertions
   that both new subqueries are issued for authed callers and neither is for
   unauth callers.
3. **Handler tests** (`exercisesGetHandler`, `exercisesListHandler`,
   `exercisesSearchHandler`) — extend to cover the not-visible → 404 / excluded
   behaviour at the handler boundary where they already stub the repo.

> **Honest limitation:** the repository suite has no real-DB integration harness,
> so true "assigned row present → visible; absent → invisible" is proven by the
> PgDialect SQL shape + device/staging verification (NFR-5), not by executing the
> query in CI. Called out so no one reads green unit tests as end-to-end proof.

---

## Part B — Mobile: unified coach library hub

### B.1 Architecture (TrainHub analog)

Mirror `TrainHubContainer` (`packages/mobile/src/ui/containers/TrainHubContainer.tsx`)
and `useTrainSegment` (`src/ui/hooks/useTrainSegment.ts`).

**New — `useCoachLibrarySegment` store** (`src/ui/hooks/useCoachLibrarySegment.ts`):

- `segment: "Programmes" | "Workouts" | "Exercises"`, default `"Programmes"`.
- AsyncStorage key `"persistence.coach.library.segment"`, hydration-race guard +
  `reset()` (called from `useAuth.signOut()`), exactly mirroring `useTrainSegment`
  (including the `hydrated` flag pattern). No `pendingSegment`/`pendingCreate`
  needed unless a deep link requires it (none in this slice).

**New — `CoachLibraryHubContainer`** (`src/ui/containers/CoachLibraryHubContainer.tsx`):

- Owns the hub chrome: top safe-area inset, eyebrow `"LIBRARY"`, segment-driven
  32pt title (`Programmes`/`Workouts`/`Exercises`), a segment-aware top-right
  contextual action, and the `<Segmented>` switcher — same layout as `TrainHub`.
- Renders the body for the active segment:
  - **Programmes** → `<ProgramsListContainer />` (body-only, see B.2)
  - **Workouts** → `<CoachWorkoutLibraryContainer embedded />` (see B.3)
  - **Exercises** → `<ExerciseListContainer />` (reused as-is, see B.4)
- Contextual action `onPress`:
  - Programmes → `router.push("/(app)/programs/create")`
  - Workouts → `router.push("/(app)/workouts/create?ctx=coach")`
  - Exercises → `router.push("/(app)/exercises/create")`
- Coach-only: the tab is already `href: null` in athlete mode
  (`(tabs)/_layout.tsx:183-189`); the sub-containers self-bounce. The hub adds no
  new gate but should be a no-op/safe if rendered in athlete mode.

**`app/(app)/(tabs)/programs.tsx`** renders `<CoachLibraryHubContainer />`
instead of `<ProgramsListContainer />`.

### B.2 Programmes body (refactor `ProgramsListPresenter` → body-only)

`ProgramsListContainer` is used **only** by the Programs tab, so it can become
body-only unconditionally. In `ProgramsListPresenter`
(`src/ui/presenters/coach/ProgramsListPresenter.tsx`):

- Remove the outer `paddingTop={insets.top}` (the hub applies it) and the
  `<HeaderBar large title="Programmes" eyebrow="… ACTIVE · … DRAFTS" trailing=+ />`
  block (L256-269). The hub provides eyebrow + title + the "New programme" `+`.
- Keep everything else: `SearchBar`, `Active/Drafts` `<Segmented>`, the
  `ProgramRowV2` list, empty states, and the dashed "+ New programme" CTA (a
  secondary create affordance — AC 1.6).
- The `N ACTIVE · N DRAFTS` count line is dropped with the HeaderBar (low value;
  the Active/Drafts segmented already labels the split). If Brad wants it kept,
  it can move to a small caption above the segmented — flagged, not built.
- Update `ProgramsListPresenter` tests that assert the HeaderBar / `programs-create-btn`
  testID.

### B.3 Workouts body (`CoachWorkoutLibraryContainer` + `embedded`)

`CoachWorkoutLibraryContainer` is used by the standalone route
`app/(app)/workouts/library.tsx` **and** (new) the hub. Add an optional
`embedded?: boolean` prop threaded to `CoachWorkoutLibraryPresenter`:

- `embedded` (hub): the presenter drops its `SafeAreaView` top edge + the header
  row (back button + centered "Workout library" title) **and its own persistent
  "Create workout" CTA** — the hub's segment-aware top-right contextual action
  owns create, so keeping the body CTA would render two identical buttons.
  Renders the list/empty/error inside a plain `View` (the hub owns chrome).
  `onBack` is unused in this mode.
- not embedded (standalone route): unchanged (header + back), so the route keeps
  working for deep links (AC 4.2).

The container passes `embedded` straight through; its cache-first logic is
unchanged. The hub renders `<CoachWorkoutLibraryContainer embedded />`.

### B.4 Exercises body (reuse `ExerciseListContainer`)

`ExerciseListContainer` (`src/ui/containers/ExerciseListContainer.tsx`) is
already body-only (it's the Train hub's Exercises body) and mode-agnostic. For a
coach, its visible set is `system ∪ own` (a coach has no coach), which is exactly
the coach's exercise library. It already has search, quick filters, long-press
delete-own, and a create CTA, and refreshes on `useExerciseLibrary` revision
bump after a create (AC 2.3). **Reuse as-is** under the Exercises segment; the
hub's contextual "Create" pushes `/exercises/create` (AC 2.1/2.2). No coach-only
variant needed.

### B.5 Retire the You-tab card (STORY-004)

- `CoachYouPresenter` (`src/ui/presenters/CoachYouPresenter.tsx` ~L271): remove
  the `onOpenWorkoutLibrary ? <Card testID="coach-workout-library">…</Card> : null`
  block and drop the now-unused `onOpenWorkoutLibrary` prop.
- `CoachYouContainer` (`src/ui/containers/CoachYouContainer.tsx:144-172`): remove
  the `onOpenWorkoutLibrary` callback + its prop pass-through.
- Update `CoachYouPresenter`/`CoachYouContainer` tests that reference the card
  (`coach-workout-library` testID).
- Leave `app/(app)/workouts/library.tsx` registered (deep-link reachable), but no
  in-app surface links to it except the hub.

### B.6 Mobile test strategy

- `useCoachLibrarySegment` store test — default, `setSegment` + persistence,
  hydration-race guard, `reset()` (mirror `useTrainSegment` tests).
- `CoachLibraryHubContainer` test — renders the `<Segmented>`; switching segment
  swaps the body (mock the three child containers); each contextual action routes
  to the right path; renders default `Programmes`.
- `ProgramsListPresenter` test updates (HeaderBar removed; body renders search +
  segmented + list + dashed CTA).
- `CoachWorkoutLibraryPresenter` test — `embedded` hides the header/back; default
  keeps them.
- `CoachYouPresenter` + `CoachYouContainer` test updates (card gone).
- ≥90% coverage on all changed/new files (NFR-2).

### B.7 What is deliberately NOT changed

- Programme model, assign flows, workout creator/editor, exercise create flow —
  untouched.
- Athlete Train hub, athlete exercise library UI — untouched (only the _server
  result set_ for an athlete narrows, per Part A).
- No new routes except the hub swap in `programs.tsx`.

---

## Rollout / verification

- Backend and mobile can land as two PRs on the slice branch (backend
  visibility is security-sensitive and warrants its own focused review +
  Inspector-Brad sweep), or one combined PR — decide at PR time.
- **Device verification (NFR-5, launch-blocker):** (1) Programs tab segments
  switch and each body renders; (2) coach creates an exercise end-to-end from
  Programs → Exercises → Create; (3) an athlete assigned a programme containing a
  coach-custom exercise can open it and see full detail, while a _different_
  athlete not assigned it does NOT see it in search. gorhom sheets are mocked in
  CI, so these are manual on a fresh EAS dev build.
- **Prod DB:** Part A is a pure query change — **no migration**. No prod DB step.
