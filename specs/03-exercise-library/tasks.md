# 03 — Exercise Library: Tasks

## Current state (2026-04-19)

**Shipped: 24 of 32 tasks complete (Phases 1-4).** Phases 5-8 are split across milestones M0 (integration + wire-format fixes) and M5 (detail + creator).

Built and verified:

- **Domain (Phase 1)** — `Exercise`, `ExerciseFilters`, `CreateExerciseInput` models in `src/domain/models/exercise.ts`; `filterExercises()` with relevance ranking and `validateExerciseInput()` in `src/domain/services/exercise.service.ts`
- **Ports & adapters (Phase 2)** — `ApiPort` extended with `getExercises`, `getExercise`, `createExercise`, `updateExercise`, `deleteExercise`; `StoragePort` extended with exercise cache methods; SST + SQLite + InMemory implementations all landed with tests (PR #26)
- **Application layer (Phase 3)** — `getExercisesQuery` (cache-first, `isStale` derived from `last_synced_at`, not row timestamps), `getExerciseQuery`, `refreshExerciseCache` (paginated walk with `REFRESH_MAX_PAGES=100` safety, atomic `last_synced_at` on full completion), `createExerciseCommand` (validates, sanitises once, saves to local cache with `local-{id}` prefix, enqueues POST sync mutation). PR #27, commit 506699c.
- **UI — Exercise List (Phase 4)** — `ExerciseCard`, `ExerciseFilterBar`, `MuscleGroupPicker`, `ExerciseListPresenter`, `ExerciseListContainer`, `ExerciseFiltersContainer` + `ExerciseFiltersPresenter` for the modal pattern, `app/(app)/exercises/[id].tsx|create.tsx|filters.tsx` screens, `(tabs)/exercises.tsx` wrapper; tests cover empty state, filter interactions, custom-exercise badge, stale banner. Phase 4.1 curated quick-filters + modal redesign shipped (commit 811b603). Stale banner preserved when filters narrow list to zero (commit 4c0c590).

Known gaps (deferred into milestones):

- **Phase 5 (Exercise detail)** — container/presenter/tests not yet built. Scoped into **M5 Exercise detail + creator**.
- **Phase 6 (Create Exercise)** — creator container/presenter/tests not yet built. Scoped into **M5**.
- **Phase 7 (Offline & sync)** — exercise cache does refresh on foreground/pull-to-refresh via `refreshExerciseCache`, but:
  - Local-search fallback over cached exercises when offline: not yet exercised end-to-end.
  - Stale cache indicator (>24h) _is_ wired (the banner), but the initial-full-sync-vs-incremental-updates distinction isn't formalised.
  - Custom exercise offline creation is enqueued via `createExerciseCommand`, but the wire-format sync-queue drift identified during Phase 4 (domain-shaped payloads not mapped through `SSTApiAdapter.mapCreateExerciseInputToApi`) is outstanding and owned by **M0 Integration baseline**.
- **Phase 8 (Quality gates)** — 357 passing tests, 99.39% lines / 93.97% branches at Phase 4 merge; Phase 4.1 and subsequent fixes have kept the bar. Final 90%-on-changed-lines gate is enforced per-PR.

Cross-milestone owners:

- **M0 Integration baseline** closes: (a) wire-format fix in `processSyncQueue` / `createExerciseCommand` payload shape; (b) backend `POST/PATCH/DELETE /exercises` handlers (mobile calls them, backend currently only serves reads); (c) filter-param mismatch — mobile enum strings vs backend UUID-keyed reference data — via a reference-lists cache.
- **M5 Exercise detail + creator** closes Phases 5 + 6.

## Phase 1: Domain

- [x] Create `Exercise` model and related types (`src/domain/models/exercise.ts`)
- [x] Create `ExerciseFilters` type
- [x] Create `CreateExerciseInput` validation type
- [x] Create exercise domain service: `filterExercises(exercises, filters)` pure function
- [x] Create exercise domain service: `validateExerciseInput(input)` pure function
- [x] Write tests for filter logic (each filter type, combined filters)
- [x] Write tests for validation (required fields, valid enums)

## Phase 2: Ports & Adapters

- [x] Extend `ApiPort` with exercise methods
- [x] Extend `StoragePort` with exercise cache methods
- [x] Implement exercise methods in SST API adapter
- [x] Implement exercise cache in SQLite adapter (create exercises table, indexes)
- [x] Implement in-memory adapters for tests
- [x] Write adapter tests

## Phase 3: Application Layer

- [x] Create `GetExercisesQuery` (cache-first with background refresh)
- [x] Create `GetExerciseQuery` (single exercise by ID)
- [x] Create `CreateExerciseCommand` (validate, save local, queue sync)
- [x] Write tests for query (returns cached, refreshes when stale)
- [x] Write tests for command (validates, persists, queues)

## Phase 4: UI — Exercise List

- [x] Create `ExerciseCard` presenter (name, muscle group, equipment, category badge)
- [x] Create `ExerciseFilterBar` presenter (filter chips, active state, clear all)
- [x] Create `MuscleGroupPicker` presenter (multi-select grid)
- [x] Create `ExerciseListPresenter` (search bar, filter bar, exercise list, empty/loading states)
- [x] Create `ExerciseListContainer` (manages search state, filters, fetches exercises)
- [x] Create `app/(app)/exercises/index.tsx` screen
- [x] Write presenter tests (renders exercises, filters, empty state)
- [x] Write container integration test (fetches and displays)

## Phase 5: UI — Exercise Detail

- [ ] Create `ExerciseDetailPresenter` (full exercise info, muscle group visual)
- [ ] Create `ExerciseDetailContainer` (fetches by ID)
- [ ] Create `app/(app)/exercises/[id].tsx` screen
- [ ] Write tests

## Phase 6: UI — Create Exercise

- [ ] Create `ExerciseCreatorPresenter` (form fields, validation errors)
- [ ] Create `ExerciseCreatorContainer` (form state, validation, submit)
- [ ] Create `app/(app)/exercises/create.tsx` screen
- [ ] Write tests (form validation, successful creation)

## Phase 7: Offline & Sync

- [ ] Implement exercise cache sync (initial full sync, incremental updates)
- [ ] Implement local search over cached exercises
- [ ] Add stale cache indicator in UI (>24 hours)
- [ ] Test offline browsing (pre-populated cache, no network)
- [ ] Test custom exercise offline creation and sync

## Phase 8: Quality Gates

- [ ] All exercise tests pass with 90% coverage
- [ ] Quality gates pass (typecheck, lint, prettier, build, test)
