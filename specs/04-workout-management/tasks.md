# 04 — Workout Management: Tasks

## Current state (2026-04-19)

**Shipped: 0 of ~40 tasks complete. Not started on mobile.**

What's there:

- **Backend** — `GET /workouts`, `GET /workouts/:id`, `POST /workouts`, `PATCH /workouts/:id`, `DELETE /workouts/:id` handlers all exist at `microservices/core/src/application/workouts/`. Ownership-scoped via JWT. Response shape vs legacy expectations is unverified.
- **Mobile `ApiPort`** already declares `getWorkouts`, `getWorkout`, `createWorkout`, `updateWorkout`, `deleteWorkout` stubs.
- The `(tabs)/workouts.tsx` screen currently renders `<ComingSoon ... />`.

Nothing else is built: no domain models, no `StoragePort` workout methods, no commands/queries, no containers/presenters, no drag-and-drop reorder, no superset logic, no visibility toggling.

Parent milestone: **M2 Workouts (list + create + edit)**. Backend brief will audit response shape against legacy `app/(tabs)/workouts.tsx`; frontend brief ports containers/presenters, wires sync queue, and builds the `ExercisePicker` shared with M3 active session.

## Phase 1: Domain

- [ ] Create `Workout`, `WorkoutExercise`, `WorkoutVisibility` models
- [ ] Create `CreateWorkoutInput`, `CreateWorkoutExerciseInput` types
- [ ] Implement `validateWorkout()` (name required, >=1 exercise, valid targets)
- [ ] Implement `calculateEstimatedDuration()` from exercises
- [ ] Implement `reorderExercises()` pure function
- [ ] Implement `groupAsSuperSet()` / `ungroupSuperSet()` pure functions
- [ ] Write tests for all domain service functions

## Phase 2: Ports & Adapters

- [ ] Extend `ApiPort` with workout CRUD methods
- [ ] Extend `StoragePort` with workout cache methods
- [ ] Implement workout methods in SST API adapter
- [ ] Implement workout cache in SQLite adapter (workouts + workout_exercises tables)
- [ ] Implement in-memory adapters for tests
- [ ] Write adapter tests

## Phase 3: Application Layer

- [ ] Create `GetWorkoutsQuery` (cache-first, background refresh)
- [ ] Create `GetWorkoutQuery` (single workout by ID)
- [ ] Create `CreateWorkoutCommand` (validate, save local, queue sync)
- [ ] Create `UpdateWorkoutCommand` (validate, update local, queue sync)
- [ ] Create `DeleteWorkoutCommand` (soft delete local, queue sync)
- [ ] Write tests for all queries and commands

## Phase 4: UI — Workout List

- [ ] Create `WorkoutCard` presenter (name, exercise count, duration, last performed)
- [ ] Create `WorkoutListPresenter` (list, sort options, empty state, loading)
- [ ] Create `WorkoutListContainer` (fetches workouts, manages sort)
- [ ] Create `app/(app)/workouts/index.tsx` screen
- [ ] Write tests

## Phase 5: UI — Workout Detail

- [ ] Create `WorkoutExerciseRow` presenter (exercise name, targets, superset indicator)
- [ ] Create `SupersetGroup` presenter (visual grouping)
- [ ] Create `WorkoutDetailPresenter` (header, exercises, actions)
- [ ] Create `WorkoutDetailContainer` (fetches workout, handles actions)
- [ ] Create `app/(app)/workouts/[id].tsx` screen
- [ ] Write tests

## Phase 6: UI — Create/Edit Workout

- [ ] Create `ExercisePicker` component (search + select from exercise library)
- [ ] Create `VisibilitySelector` component (private/friends/public)
- [ ] Create `WorkoutEditorPresenter` (form: name, description, exercise list, superset controls, reorder, visibility)
- [ ] Create `WorkoutEditorContainer` (form state, validation, add/remove/reorder exercises, submit)
- [ ] Create `app/(app)/workouts/create.tsx` and `app/(app)/workouts/[id]/edit.tsx` screens
- [ ] Implement drag-and-drop reordering for exercises
- [ ] Write tests (form validation, exercise management, superset grouping)

## Phase 7: Delete & Visibility

- [ ] Implement delete with confirmation dialog
- [ ] Implement visibility change
- [ ] Write tests (delete flow, visibility toggle)

## Phase 8: Quality Gates

- [ ] All workout tests pass with 90% coverage
- [ ] Quality gates pass
