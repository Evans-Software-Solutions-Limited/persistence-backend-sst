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

## Phase 04.3 — Create exercise (full-screen) (1 PR)

- [x] **T-04.3.1** Author `<ExerciseFormFields>` shared internal component covering name + photo + primary muscle + secondary muscles + equipment + level + instructions. Used by both the create screen and the 04.6 editor. Implements STORY-006 + STORY-008 ACs. _(Pure form-model + UI→domain conversion live alongside in `exerciseForm.ts`.)_
- [x] **T-04.3.2** Author `<CreateExercisePresenter>` — full-screen: `<HeaderBar>` (close + "New exercise") + `KeyboardAvoidingView` + `ScrollView` containing `<ExerciseFormFields>` + live PREVIEW chip, with a sticky Cancel/Save footer. Implements STORY-006 ACs.
- [x] **T-04.3.3** Author `<CreateExerciseContainer>` wiring `createExerciseCommand` (the real V2 mutation — there is no `useCreateExercise()` hook; the spec referenced one that never existed). Pulls `userId` from `useAuth`, `storage` from `useAdapters`; on success bumps `useExerciseLibrary` so the list re-reads (AC 6.5), then `router.back()`.
- [x] **T-04.3.4** `(app)/exercises/create.tsx` renders `<CreateExerciseContainer>` full-screen; the Train hub `+ Create` action + the Exercises empty-state CTA `router.push` it. Closes STORY-006 AC 6.1.
- [x] **T-04.3.5** `create.tsx` is a real full-screen route (no redirect stub). Deep links to `/exercises/create` resolve directly. The old full-screen creator (`DevExerciseCreatorContainer` + its test) is removed as orphaned. Closes STORY-006 AC 6.6.
- [x] **T-04.3.6** "Saved ✓" affirmation for 700ms after successful save before the screen pops. Closes STORY-006 AC 6.5.
- [x] **T-04.3.7** Form state via controlled `value`/`onChange` (NOT `react-hook-form` — it isn't a dependency of `packages/mobile`, and the controlled contract keeps `<ExerciseFormFields>` portable between the create screen and the 04.6 editor). Save disabled until name is non-empty + guarded against double-tap (synchronous in-flight ref).

> **Revised 2026-06-03 (Phase 04.3 — full-screen, not a sheet):** create-exercise moved off the `<BottomSheet>` (originally specced) to a **full-screen route**. The 8-section form needs reliable scroll + keyboard handling that the gorhom sheet kept fighting on device; full-screen matches the legacy creator + the 04.6 editor and reuses the same `<ExerciseFormFields>`. Brad signed off (2026-06-03). The sheet-only machinery added earlier in 04.3 (`useCreateExerciseSheet` open-state store, the root-layout mount, the sign-out reset, the `pendingCreate`/redirect-stub path) is **removed**. The shared `<BottomSheet>` primitive fixes from this work (gorhom `enableDynamicSizing={false}` + the scroll-view `flex: 1`) stay — they correct ProfileDrawer + other sheets too.
>
> **Revised 2026-06-02 (Phase 04.3 — Cardio dropped):** The prototype's **Cardio** primary-muscle chip is dropped for now — V2's `validateExerciseInput` requires ≥1 primary muscle and there's no `cardio`/`full-body` muscle enum, so the design's `Cardio → []` mapping would fail validation on Save. Cardio-as-a-category is a larger, dedicated future slice (Brad's call, 2026-06-02). Remaining labels each map to ≥1 valid muscle; `category` is always `"strength"`. Conversion emits domain enum _keys_ (`"chest"`, `"barbell"`) per `design.md`, not reference-list UUIDs (UUID resolution touches the adapter layer that STORY-009 freezes). The exercise-list refresh after a create uses a new `useExerciseLibrary` signal store (the create screen bumps it, the list folds it into its cache-read deps).

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

- [x] **T-04.6.1** Build `<ExerciseDetailPresenter>` + `<ExerciseDetailContainer>` + `useExercise` hook. Route `[id].tsx` → `[id]/index.tsx`. Implements STORY-007 ACs.
- [x] **T-04.6.2** Build `<ExerciseEditorPresenter>` + `<ExerciseEditorContainer>` composing `<ExerciseFormFields>` full-screen, route `[id]/edit.tsx`, offline-first `updateExerciseCommand`. Implements STORY-008 ACs.

> **Revised 2026-06-05 (Phase 04.6):** the design package said "V2 already has it / preserved" for both screens — this was stale. `exercises/[id].tsx` was a placeholder and there was no editor route; both are **built fresh** as a design-port to the foundation system (`HeaderBar`/`Card`/`Pill`/Lucide), there being no detail/editor prototype in `handoff/design-source` (only `create-exercise.jsx` + `library.jsx`). Deltas from the original spec, all signed off:
>
> - **Detail body** drops the legacy PR-carousel / recent-sets / accessibility sections — V2's `GET /exercises/:id` returns no per-user history and there are no accessibility columns. Renders only the sections design.md lists (photo, name+level, description, primary/secondary muscles, equipment, instructions).
> - **Editor save is offline-first** via `updateExerciseCommand`: optimistic local write, then **coalesce** onto a still-pending mutation for the same exercise (rewriting a queued create's payload in place so it stays a `POST` — never `PATCH`-ing a `local-*` id the server hasn't assigned), else enqueue a **`PATCH /exercises/:id`** (the adapter uses PATCH, not the `PUT` the doc named). Satisfies AC 8.2 + 8.3.
> - **Preserve-granular-unless-changed**: the coarse picker is lossier than the stored granular muscle/equipment arrays, so the container keeps the original arrays for any field the user didn't touch and only re-expands a changed picker.
> - **One additive `StoragePort` method** — `updateMutationPayload(id, payload)` (SQLite + InMemory) — powers the coalescing. No sync-engine handler, `api.port`, or migration change, so STORY-009's freeze + the existing 90% application-layer coverage hold.
> - `<ExerciseFormFields>` gained an additive `autoFocus?` prop (default true) so the editor opens without popping the keyboard over a populated form. Create + edit keep **separate** presenters (the shared shell extraction was considered and declined to avoid touching the device-verified create screen).

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
