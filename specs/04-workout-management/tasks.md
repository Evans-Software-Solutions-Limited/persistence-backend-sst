# 04 — Workout Management: Tasks

## Current state (2026-04-28)

**Shipped: 0 of ~50 M2-scoped tasks complete. Backend has metadata-only CRUD; mobile is a `<ComingSoon>` stub.**

What's there:

- **Backend** — `GET /workouts`, `GET /workouts/:id`, `POST /workouts`, `PATCH /workouts/:id`, `DELETE /workouts/:id` handlers exist at `microservices/core/src/application/workouts/`. Ownership-scoped via JWT. Wire format gaps audited against legacy expectations (see `specs/milestones/M2-workouts/BACKEND_BRIEF.md`):
  - `getById` response missing `supersetGroup` field on the exercises array — fix.
  - `POST /workouts` accepts metadata only — extend to accept nested `exercises[]` and run as a single transaction.
  - `PATCH /workouts/:id` accepts metadata only — extend to accept full-replacement `exercises[]` and run as a single transaction.
  - List response missing `meta.quota` for `type=mine`; missing `meta.pagination.total`.
  - List response missing nested `exercises[]` per workout (legacy WorkoutCard needs it).
  - Test gaps: no two-user isolation case on list / get / update / delete; no friends-visibility positive path; no nested-exercise mutation tests; no superset assertion.
- **Mobile `ApiPort`** declares `getWorkouts / getWorkout / createWorkout / updateWorkout / deleteWorkout` against the M2-incomplete shape (`CreateWorkoutInput` has no `exercises` field). M2 mobile updates the port + adapter to match the new wire-format.
- **`(tabs)/workouts.tsx`** currently renders `<ComingSoon />`.

Nothing else is built: no domain model, no `StoragePort` workout methods, no SQLite cache tables, no commands/queries, no containers/presenters, no superset logic, no exercise-picker sheet, no quota indicator.

Parent milestone: **M2 Workouts (list + create + edit)**. Briefs: [`../milestones/M2-workouts/`](../milestones/M2-workouts/).

## Phase 1: Spec alignment + parent-spec updates (M2 commit 1)

- [x] Audit legacy `app/(tabs)/workouts.tsx`, `workout-creator.tsx`, `workout-editor.tsx` (done 2026-04-28)
- [x] Audit V2 backend `workouts/` handlers + repository against legacy (done 2026-04-28)
- [x] Update `design.md` with corrected domain model (`targetRepsMin/Max`, `targetDurationSeconds`, `supersetGroup`), API contract section, SQLite cache shape, offline strategy
- [x] Update `requirements.md` with STORY-001..009 ACs covering tabs / search / quota / superset propagation / dirty-form discard / two-user isolation
- [x] Mark this `tasks.md` with M2 vs M11 vs M3 vs M8 boundaries

## Phase 2: Backend domain + repository (M2 backend PR)

- [ ] Add `supersetGroup` to `WorkoutWithExercises.exercises[]` response type and select clause in `WorkoutRepository.getById`
- [ ] Extend `WorkoutRepository.list` to include `exercises[]` per workout (single grouped query joining `workout_exercises` + `exercises`)
- [ ] Extend `WorkoutRepository.list` to return total count for `meta.pagination.total`
- [ ] Add `WorkoutRepository.getQuota(userId)` returning `{ used, limit }` (count own workouts + read `subscriptions.workoutLimit`)
- [ ] Refactor `WorkoutRepository.create` → `createWithExercises(userId, data)` running both inserts in one Drizzle transaction
- [ ] Refactor `WorkoutRepository.update` → support optional `exercises` full-replacement in a transaction
- [ ] Update `default` filter to exclude user's own public workouts (`createdBy != userId`)

## Phase 3: Backend handlers + tests (M2 backend PR)

- [ ] Update list handler envelope to `{ data, meta: { pagination, quota? } }`; quota only present when `type=mine`
- [ ] Update create handler request body schema (Elysia `t.Object`) to accept nested `exercises` array
- [ ] Update update handler request body schema to accept optional `exercises` array
- [ ] Add two-user isolation tests on every handler (list / get / update / delete)
- [ ] Add friends-visibility positive-path test on get
- [ ] Add nested-exercise mutation tests on create + update (including superset round-trip)
- [ ] Add quota envelope test on list
- [ ] All handlers + repository at ≥90% coverage on every metric

## Phase 4: Mobile domain + ports + adapters (M2 mobile PR)

- [ ] Create `Workout`, `WorkoutExercise`, `WorkoutVisibility`, `WorkoutListType`, `WorkoutQuota` domain models in `packages/mobile/src/domain/models/workout.ts`
- [ ] Update `ApiPort` workout method signatures (replace M1 stubs) — `getWorkouts` returns `{ workouts, quota? }`; `createWorkout` / `updateWorkout` accept nested exercises
- [ ] Extend `StoragePort` with workout cache methods (list scoped by `type`, detail scoped by `id`)
- [ ] Implement workout methods in `SSTApiAdapter` (parse double-envelope on list, single on detail)
- [ ] Implement `cached_workouts` + `cached_workout_detail` SQLite tables + cache methods
- [ ] Implement workout methods in `InMemoryApiAdapter` for tests
- [ ] Wire workout writes through `SyncQueuePort` (create / update / delete enqueue intents)

## Phase 5: Mobile application layer (M2 mobile PR)

- [ ] Implement `validateWorkout`, `calculateEstimatedDuration`, `reorderExercises`, `groupAsSuperSet`, `ungroupSuperSet`, `propagateSupersetSharedFields` pure functions + tests
- [ ] Create `getWorkoutsQuery` (cache-first, background refresh, 5-min TTL) — runs three parallel calls (mine / assigned / default) under one hook
- [ ] Create `getWorkoutQuery` (single workout by ID)
- [ ] Create `createWorkoutCommand` (validate + queue + optimistic local cache)
- [ ] Create `updateWorkoutCommand`
- [ ] Create `deleteWorkoutCommand`
- [ ] Implement `useWorkouts` hook (mirrors `useDashboard` shape — cache-first, in-flight ref keyed on userId, stale-closure guards on session-scoped writes)
- [ ] Implement `useWorkout(id)` hook for the popover detail

## Phase 6: Mobile UI port — list (M2 mobile PR)

- [ ] Port `WorkoutCard` from legacy verbatim (theme shim only)
- [ ] Port `WorkoutSection` from legacy verbatim
- [ ] Port `WorkoutPopover` from legacy verbatim
- [ ] Port `WorkoutLimitIndicator` from legacy verbatim
- [ ] Port `QuickActions` from legacy verbatim
- [ ] Create `workoutsLegacyTheme.ts` extending `homeLegacyTheme.ts` with any missing tokens
- [ ] Create `WorkoutsListContainer` mirroring `HomeContainer`'s 3-memo pipeline
- [ ] Create `WorkoutsListPresenter` (search, three sections, pull-to-refresh, popover, quota indicator)
- [ ] Replace `(tabs)/workouts.tsx` `<ComingSoon />` with `<WorkoutsListContainer />`
- [ ] Tests: container view-model derivation, empty states, search filter, pull-to-refresh, two-user cache isolation

## Phase 7: Mobile UI port — creator + editor (M2 mobile PR)

- [ ] Port `AddExercisePopover` (the bottom sheet) from legacy verbatim, but wrap M0's `ExerciseListContainer` instead of legacy hooks
- [ ] Port `AddExerciseList` + `AddExerciseListItem` (multi-select)
- [ ] Port `ExerciseDetailsModal` (drill-in detail inside picker)
- [ ] Port `ExerciseConfigCard` from legacy verbatim (per-exercise card with superset visual grouping)
- [ ] Create `WorkoutCreatorContainer` (form state via reducer; validates on submit)
- [ ] Create `WorkoutCreatorPresenter` (form layout from legacy `workout-creator.tsx`)
- [ ] Create `WorkoutEditorContainer` (async-loaded form state; dirty flag; submit fires PATCH)
- [ ] Create `WorkoutEditorPresenter` (re-uses creator presenter where layout matches)
- [ ] Wire navigation: `Create` CTA → `/workouts/create`; `Edit` CTA → `/workouts/[id]/edit`
- [ ] Add discard-changes confirmation on dirty back-nav
- [ ] Tests: form validation, exercise add / remove / regroup, superset propagation, dirty flag, optimistic UI

## Phase 8: Smoke + quality gates (M2 both PRs)

- [ ] All workout backend tests pass with 90% coverage on every changed file
- [ ] All workout mobile tests pass with 90% coverage on every changed file
- [ ] `bun run prettier:check`, `typecheck`, `lint`, `build`, `test:unit` all clean on both branches
- [ ] Smoke test (`SMOKE_TEST.md`) passes against `bun run dev` + iOS simulator end-to-end

## Phase 9 (deferred): drag-and-drop reorder

Originally listed under STORY-002 but legacy doesn't ship explicit drag-and-drop. **Deferred to M11 polish.** When implemented:

- [ ] Wrap exercise rows in `react-native-draggable-flatlist`
- [ ] Onboarding tooltip on first edit
- [ ] Visual cue on drag (lift + shadow)

## Phase 10 (deferred): soft-delete on workouts that have sessions

Hard delete keeps `workouts.id` referenced by `workout_sessions.workoutId` via FK `set null`. Sessions retain their data but lose template lineage. For M4 progress analytics it'd be useful to keep template names / structures available even after deletion.

- [ ] Add `deleted_at` (timestamp) to `workouts` schema (migration)
- [ ] List + get filter `deleted_at IS NULL`
- [ ] DELETE handler sets `deleted_at = now()` instead of issuing SQL DELETE
- [ ] Add admin/internal endpoint to hard-purge soft-deleted rows older than N days
