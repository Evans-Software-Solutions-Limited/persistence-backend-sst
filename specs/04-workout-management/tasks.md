# 04 — Workout Management: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks preserved in git history. This list scopes the design-package port for the workout management surfaces.

---

## Phase 04.1 — WorkoutsList rewrite (1 PR)

- [x] **T-04.1.1** Author `<WorkoutRow>` composite in `packages/mobile/src/ui/components/workouts/WorkoutRow/`. Tests + smoke route. Implements `requirements.md` STORY-001 AC 1.2.
- [x] **T-04.1.2** Rewrite `<WorkoutsListPresenter>` to use `<Section>` + `<Card>` + `<WorkoutRow>` + `<Btn>` per `design.md`. Implements STORY-001 ACs.
- [x] **T-04.1.3** Rewire `<WorkoutsListContainer>` to mount under `<TrainHubContainer>`'s Workouts segment. Closes STORY-001 AC 1.5.
- [x] **T-04.1.4** Update presenter tests for the new structure (three sections, empty state, quota indicator).
- [ ] **T-04.1.5** Visual regression screenshots vs `library.jsx`. _(Deferred to reviewer's on-device pass — RN UI can't be screenshotted from the build env.)_

## Phase 04.2 — ExerciseList rewrite (PR #96)

- [x] **T-04.2.1** Author `<FilterChip>` + `<ExerciseCard>` composites in `packages/mobile/src/ui/components/exercises/`. Tests + smoke route. Implements STORY-005 AC 5.5. _(New library `<ExerciseCard>` is distinct from the root `@/ui/components/ExerciseCard` still used by active-session; 3pt left-border is fixed `$primary` per the prototype — not muscle-derived, which avoids the UUID-vs-enum trap.)_
- [x] **T-04.2.2** Rewrite `<ExerciseListPresenter>` to use `<SearchBar>` (from `01-design-system`) + horizontally-scrolling chip row + list of `<ExerciseCard>`. Implements STORY-005 ACs. _(Retained `FlatList` — `@shopify/flash-list` is not a dependency; FlashList is M11 perf scope.)_
- [x] **T-04.2.3** Rewire `<ExerciseListContainer>` to mount under `<TrainHubContainer>`'s Exercises segment. _(Already mounted by `14-navigation`; container unchanged — presenter is now a headerless body.)_
- [x] **T-04.2.4** Preserve filter sub-routes at `(app)/exercises/filters/*`. _(Untouched; advanced muscle/equipment filtering reachable via the filter `<IconBtn>` → `/(app)/exercises/filters`.)_

> **Revised 2026-06-01 (PR #96 review):** Built from `prototype-hubs.jsx § TrainExercisesContent` (canonical hub), superseding `library.jsx`. Also folded in two shared-primitive fixes surfaced in review — `<Btn>` now tints its icon to the foreground colour, and `<Segmented>` is content-width (not full-width) to match the prototype's `inline-flex`. Quick-filter pills match legacy's set (no muscle-group quick pills in legacy — those live in the modal); `PT Assigned`/`Physio Assigned` remain deferred to M8 (no V2 relationship data). The Workouts-segment search button stays a deferred STORY-007 placeholder pending a design.

## Phase 04.3 — CreateExerciseSheet (1 PR)

- [x] **T-04.3.1** Author `<ExerciseFormFields>` shared internal component covering name + photo + primary muscle + secondary muscles + equipment + level + instructions. Used by both sheet and full-screen editor. Implements STORY-006 + STORY-008 ACs. _(Pure form-model + UI→domain conversion live alongside in `exerciseForm.ts`.)_
- [x] **T-04.3.2** Author `<CreateExerciseSheetPresenter>` per `design.md § CreateExerciseSheetPresenter`. Uses `<BottomSheet>` (`height="tall"` = 88%) + `<ExerciseFormFields>` + live PREVIEW chip + footer Cancel/Save. Implements STORY-006 ACs.
- [x] **T-04.3.3** Author `<CreateExerciseSheetContainer>` wiring `createExerciseCommand` (the real V2 mutation — there is no `useCreateExercise()` hook; the spec referenced one that never existed). Pulls `userId` from `useAuth`, `storage` from `useAdapters`; on success bumps `useExerciseLibrary` so the list re-reads (AC 6.5).
- [x] **T-04.3.4** Mount the sheet inside `<TrainHubContainer>` (per `design.md`). Closes STORY-006 AC 6.1.
- [x] **T-04.3.5** Convert `app/(app)/exercises/create.tsx` to a deep-link **redirect stub** (sets segment=Exercises + `pendingCreate`, replaces with the Train tab) rather than a hard delete + a `14-navigation` map entry. The 14.7 `LegacyRedirects` map is deferred/unbuilt, so a hard delete would 404 the deep link; the stub is the self-contained redirect home. The full-screen creator (`DevExerciseCreatorContainer` + its test) is removed as orphaned. Closes STORY-006 AC 6.6. _(See requirements revision 2026-06-02.)_
- [x] **T-04.3.6** "Saved ✓" affirmation for 700ms after successful save before sheet closes. Closes STORY-006 AC 6.5.
- [x] **T-04.3.7** Form state via controlled `value`/`onChange` (NOT `react-hook-form` — it isn't a dependency of `packages/mobile`, and the controlled contract keeps `<ExerciseFormFields>` portable between the sheet and the 04.6 editor). Save disabled until name is non-empty.

> **Revised 2026-06-02 (Phase 04.3):** The prototype's **Cardio** primary-muscle chip is dropped for now — V2's `validateExerciseInput` requires ≥1 primary muscle and there's no `cardio`/`full-body` muscle enum, so the design's `Cardio → []` mapping would fail validation on Save. Cardio-as-a-category is a larger, dedicated future slice (Brad's call, 2026-06-02). Remaining labels each map to ≥1 valid muscle; `category` is always `"strength"`. Conversion emits domain enum _keys_ (`"chest"`, `"barbell"`) per `design.md`, not reference-list UUIDs (UUID resolution touches the adapter layer that STORY-009 freezes). The exercise-list refresh after a create uses a new `useExerciseLibrary` signal store (sheet bumps it, list folds it into its cache-read deps).

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
