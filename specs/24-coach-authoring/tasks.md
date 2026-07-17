# 24 — Coach Authoring & Library IA: Tasks

> Execution checklist. `[B]` = backend (`microservices/core`), `[M]` = mobile
> (`packages/mobile`). See `design.md` for the how; ACs reference
> `requirements.md`.

## Phase 1 — Backend: assignment-scoped visibility (STORY-003)

- [ ] **T-1.1 [B]** In `exerciseRepository.ts`, add imports: `workoutExercises`,
      `workoutAssignments`, `programWorkouts`, `programAssignments` from
      `@persistence/db`; `LIVE_ASSIGNMENT_STATUSES` from `programRepository` (inline
      the tuple if it cycles — see design § A.4).
- [ ] **T-1.2 [B]** Add `programmeAssignedExerciseIdsSubquery(userId)` and
      `assignedWorkoutExerciseIdsSubquery(userId)` (design § A.2).
- [ ] **T-1.3 [B]** Replace the blanket `inArray(exercises.createdBy,
activeTrainerIdsSubquery(userId))` branch in `buildVisibilityCondition` with the
      two `inArray(exercises.id, …)` branches. Keep system + own branches and the
      unauth path unchanged. Keep `activeTrainerIdsSubquery` (still used by the
      `created_by=pt` filter).
- [ ] **T-1.4 [B]** Verify `workout_exercises(workout_id)` and
      `program_workouts(workout_id)` are indexed (they're FKs); if not, note/add an
      index (design § A.5). No data migration.
- [ ] **T-1.5 [B]** PgDialect SQL-shape test (design § A.6 layer 1) — the primary
      guard against the mocked-`getDb` blind spot.
- [ ] **T-1.6 [B]** Update authed-visibility call-shape tests (`list`, `search`,
      `getById`, `count`) for the new subquery selects; assert both subqueries fire
      for authed callers, neither for unauth (design § A.6 layer 2).
- [ ] **T-1.7 [B]** Handler tests: not-visible → 404 / excluded (design § A.6
      layer 3). Confirm no regression in existing exercise handler tests.

## Phase 2 — Mobile: unified coach hub (STORY-001/002)

- [ ] **T-2.1 [M]** Add `useCoachLibrarySegment` store (design § B.1) + tests.
- [ ] **T-2.2 [M]** Wire `reset()` into `useAuth.signOut()` alongside the existing
      `useTrainSegment.reset()` call.
- [ ] **T-2.3 [M]** Refactor `ProgramsListPresenter` → body-only (drop HeaderBar +
      outer inset); update its tests (design § B.2).
- [ ] **T-2.4 [M]** Add `embedded?` to `CoachWorkoutLibraryContainer` +
      `CoachWorkoutLibraryPresenter`; hide header/back when embedded; update tests
      (design § B.3).
- [ ] **T-2.5 [M]** Add `CoachLibraryHubContainer` (chrome + segment switch +
      contextual actions) rendering the three bodies (Programmes = ProgramsList,
      Workouts = CoachWorkoutLibrary `embedded`, Exercises = ExerciseList reused) +
      tests.
- [ ] **T-2.6 [M]** Point `app/(app)/(tabs)/programs.tsx` at
      `CoachLibraryHubContainer`.

## Phase 3 — Mobile: retire You-tab card (STORY-004)

- [ ] **T-3.1 [M]** Remove the "Workout library" card from `CoachYouPresenter` +
      the `onOpenWorkoutLibrary` prop; remove the callback in `CoachYouContainer`.
      Update tests. Leave `workouts/library.tsx` route registered.

## Phase 4 — Gates + review + handoff

- [ ] **T-4.1** From repo root: `bun run prettier:check`, `bun run typecheck`,
      `bun run lint`, `bun run build`, `bun run test:unit` — paste output. ≥90%
      coverage on changed files.
- [ ] **T-4.2** Run `inspector-brad` on the branch diff; fix 🔴/🟠/🟡 or justify;
      re-run until clean. Note the sweep sha in the PR body. Do **not** fire the CI
      action.
- [ ] **T-4.3** Write the device-verify checklist (design § Rollout, NFR-5) into
      the PR body. Do **not** claim device-verified.
- [ ] **T-4.4** Update `STATE.md` (what shipped, the visibility-narrowing
      decision, device-verify pending).

## Notes / risks

- Visibility change is data-isolation-sensitive (CLAUDE.md § Dangerous Areas) —
  the PgDialect shape test + two-user reasoning in T-1.5/1.6 are the guard; true
  end-to-end is device/staging (no repo integration-DB harness).
- Port-fidelity: only the coach programme/workout **chrome** moves to the hub;
  render output of the bodies is otherwise unchanged (NFR-3).
