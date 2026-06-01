# 04 — Workout Management: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks preserved in git history. This list scopes the design-package port for the workout management surfaces.

---

## Phase 04.1 — WorkoutsList rewrite (1 PR)

- [x] **T-04.1.1** Author `<WorkoutRow>` composite in `packages/mobile/src/ui/components/workouts/WorkoutRow/`. Tests + smoke route. Implements `requirements.md` STORY-001 AC 1.2.
- [x] **T-04.1.2** Rewrite `<WorkoutsListPresenter>` to use `<Section>` + `<Card>` + `<WorkoutRow>` + `<Btn>` per `design.md`. Implements STORY-001 ACs.
- [x] **T-04.1.3** Rewire `<WorkoutsListContainer>` to mount under `<TrainHubContainer>`'s Workouts segment. Closes STORY-001 AC 1.5.
- [x] **T-04.1.4** Update presenter tests for the new structure (three sections, empty state, quota indicator).
- [ ] **T-04.1.5** Visual regression screenshots vs `library.jsx`. _(Deferred to reviewer's on-device pass — RN UI can't be screenshotted from the build env.)_

## Phase 04.2 — ExerciseList rewrite (1 PR)

- [ ] **T-04.2.1** Author `<FilterChip>` + `<ExerciseCard>` composites in `packages/mobile/src/ui/components/exercises/`. Tests + smoke route. Implements STORY-005 AC 5.5.
- [ ] **T-04.2.2** Rewrite `<ExerciseListPresenter>` to use `<SearchBar>` (from `01-design-system`) + horizontally-scrolling chip row + `FlashList` of `<ExerciseCard>`. Implements STORY-005 ACs.
- [ ] **T-04.2.3** Rewire `<ExerciseListContainer>` to mount under `<TrainHubContainer>`'s Exercises segment.
- [ ] **T-04.2.4** Preserve filter sub-routes at `(app)/exercises/filters/*`.

## Phase 04.3 — CreateExerciseSheet (1 PR)

- [ ] **T-04.3.1** Author `<ExerciseFormFields>` shared internal component covering name + photo + primary muscle + secondary muscles + equipment + level + instructions. Used by both sheet and full-screen editor. Implements STORY-006 + STORY-008 ACs.
- [ ] **T-04.3.2** Author `<CreateExerciseSheetPresenter>` per `design.md § CreateExerciseSheetPresenter`. Uses `<BottomSheet>` + `<ExerciseFormFields>` + footer Cancel/Save. Implements STORY-006 ACs.
- [ ] **T-04.3.3** Author `<CreateExerciseSheetContainer>` wiring `useCreateExercise()` (existing V2 mutation).
- [ ] **T-04.3.4** Mount the sheet inside `<TrainHubContainer>` (per `design.md`). Closes STORY-006 AC 6.1.
- [ ] **T-04.3.5** Delete `app/(app)/exercises/create.tsx`. Add deep-link redirect to `14-navigation`'s map. Closes STORY-006 AC 6.6.
- [ ] **T-04.3.6** "Saved ✓" affirmation for 700ms after successful save before sheet closes. Closes STORY-006 AC 6.5.
- [ ] **T-04.3.7** Form state via `react-hook-form`. Save button disabled until name is non-empty.

## Phase 04.4 — WorkoutDetail rewrite (1 PR)

- [ ] **T-04.4.1** Rewrite `<WorkoutDetailPresenter>` shell to use `<HeaderBar>` + `<Card>` + `<Btn>` + new tokens per `design.md`. Implements STORY-003 ACs.
- [ ] **T-04.4.2** Superset bracket render — vertical bar on the left of grouped exercise rows, `$primary` tinted.
- [ ] **T-04.4.3** Update presenter tests (Edit IconBtn hidden for non-owners; Start CTA wires `onStartSession`).
- [ ] **T-04.4.4** Visual regression vs the prototype's workout-detail equivalent (no dedicated prototype screen — match V2's PR #41 shape with new chrome).

## Phase 04.5 — WorkoutCreator + WorkoutEditor rewrite (1 PR)

- [ ] **T-04.5.1** Rewrite both presenter shells with new tokens + `<HeaderBar>` + `<Card>` + `<Btn>`. Implements STORY-002 + STORY-004 ACs.
- [ ] **T-04.5.2** `<ExerciseConfigCard>` internal styling refresh through new primitives (preserves behaviour).
- [ ] **T-04.5.3** `<AddExercisePopover>` internal styling refresh (already a sheet-style popover in V2).
- [ ] **T-04.5.4** Validation + dirty-form-back-nav prompt + offline submit (preserved from V2).

## Phase 04.6 — ExerciseDetail + ExerciseEditor rewrite (1 PR)

- [ ] **T-04.6.1** Rewrite `<ExerciseDetailPresenter>` shell. Implements STORY-007 ACs.
- [ ] **T-04.6.2** Rewrite `<ExerciseEditorPresenter>` shell to compose `<ExerciseFormFields>` (shared with sheet from T-04.3.1). Full-screen layout. Implements STORY-008 ACs.

## Phase 04.7 — Cleanup + verification

- [ ] **T-04.7.1** Run `01-design-system § Codemod` against new files to scrub any residual hex literals.
- [ ] **T-04.7.2** Verify `useStartSession` integration with `05-active-session` (gate: T-04.4.1 + 05 spec landing). Manual smoke: tap Start from workout detail → land in active session.
- [ ] **T-04.7.3** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [ ] **T-04.7.4** 90% coverage on touched files. Application layer coverage preserved.
- [ ] **T-04.7.5** Manual e2e: athlete user navigates Train > Workouts → creates a new workout (online) → goes offline → creates another → reconnects → assert sync. Switch to Train > Exercises → creates an exercise via sheet → assert appears in Mine filter.

---

## Acceptance gate (workout management phase complete)

- [ ] All 7 phases above shipped as PRs.
- [ ] No backend changes (confirmed by `git diff main microservices/` being empty for this spec's PRs).
- [ ] Train hub renders both segments end-to-end without regressions.
- [ ] Existing V2 `useStartSession`, `useGetWorkoutById`, `useGetExercises`, `useCreateExercise`, etc. hooks all still callable with the same signatures.
- [ ] Offline-first behaviour preserved — manual e2e in T-04.7.5 passes.
- [ ] CI green; 90% coverage on touched files; application layer coverage unchanged.

---

_End of `04-workout-management/tasks.md` · 2026-05-27 (rewritten from scratch)_
