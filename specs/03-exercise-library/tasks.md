# 03 — Exercise Library: Tasks

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

- [ ] Create `GetExercisesQuery` (cache-first with background refresh)
- [ ] Create `GetExerciseQuery` (single exercise by ID)
- [ ] Create `CreateExerciseCommand` (validate, save local, queue sync)
- [ ] Write tests for query (returns cached, refreshes when stale)
- [ ] Write tests for command (validates, persists, queues)

## Phase 4: UI — Exercise List

- [ ] Create `ExerciseCard` presenter (name, muscle group, equipment, category badge)
- [ ] Create `ExerciseFilterBar` presenter (filter chips, active state, clear all)
- [ ] Create `MuscleGroupPicker` presenter (multi-select grid)
- [ ] Create `ExerciseListPresenter` (search bar, filter bar, exercise list, empty/loading states)
- [ ] Create `ExerciseListContainer` (manages search state, filters, fetches exercises)
- [ ] Create `app/(app)/exercises/index.tsx` screen
- [ ] Write presenter tests (renders exercises, filters, empty state)
- [ ] Write container integration test (fetches and displays)

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
