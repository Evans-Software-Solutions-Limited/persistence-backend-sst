# M2 — Mobile Follow-up Brief: Workout Creator + Editor

You are the agent picking up the second mobile slice of M2 — Workouts. The first slice ([PR #40](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/40)) shipped the read surface (list + detail popover); your job is to ship the **write surface** (create + edit forms).

Read [`BRIEF.md`](./BRIEF.md), [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md), [`SMOKE_TEST.md`](./SMOKE_TEST.md), and the parent spec [`../../04-workout-management/`](../../04-workout-management/) before starting. The frontend brief is the binding spec — this document only covers what's left and what the previous slice taught us.

## Branch + workflow

- **Branch:** `feat/m2-mobile-workouts-2` off fresh `main` (after PR #40 merges).
- **PR title:** `feat(mobile): port workouts creator + editor from legacy (M2 follow-up)`
- **Commit shape (3–5 commits):**
  1. `feat(mobile): port AddExercisePopover + ExerciseConfigCard from legacy`
  2. `feat(mobile): WorkoutCreatorContainer + Presenter + create.tsx route`
  3. `feat(mobile): WorkoutEditorContainer + Presenter + [id]/edit.tsx route`
  4. `test(mobile): creator + editor containers / presenters / commands`

Each commit ends with the standard footer (`Spec alignment:` + `Co-Authored-By:`).

## What you're inheriting (foundation, already done)

**Domain + ports + adapters:** `Workout`, `WorkoutExercise`, `WorkoutListType`, `WorkoutQuota`, `CreateWorkoutInput`, `UpdateWorkoutInput`, `CachedWorkoutsList`, `CachedWorkoutDetail` in `src/domain/models/workout.ts`. SQLite adapter has `cached_workouts` (PK `(user_id, type)`) + `cached_workout_detail` (PK `(user_id, workout_id)`). SST API adapter implements the full nested-exercise wire format from PR #39.

**Pure domain functions** in `src/domain/services/workout.service.ts`: `validateWorkoutInput`, `sanitizeCreateWorkoutInput`, `calculateEstimatedDuration`, `reorderExercises`, `groupAsSuperSet`, `ungroupSuperSet`, `propagateSupersetSharedFields`. Reuse these in the form reducer — don't reinvent.

**Application layer:**

- `src/application/queries/workouts.query.ts` — `getWorkoutsQuery`, `refreshWorkouts`, `refreshAllWorkouts`.
- `src/application/commands/create-workout.command.ts` — offline-first; validates → sanitizes → temp `local-` UUID → cache → enqueue POST. **Already integrates with the sync queue** — your container just calls it.
- `src/application/commands/update-workout.command.ts` — full-replacement on `exercises` when present; merges metadata; enqueues PATCH.
- `src/application/commands/delete-workout.command.ts` — drops from cache + enqueues DELETE.

**Hook:** `src/ui/hooks/useWorkouts.tsx` (3-section parallel) and `src/ui/hooks/useWorkout.tsx` (single workout for the editor's initial load — you'll need to add this if it's not there yet; check and clone the useDashboard pattern keyed on `workoutId`).

**Verbatim-ported components** already in the tree:

- `src/ui/components/workouts/{WorkoutCard,WorkoutSection,WorkoutPopover,WorkoutLimitIndicator,QuickActions}/` — list-side. You don't touch these.
- `src/ui/components/Popover.tsx` — generic modal wrapper. Reusable for the picker if needed.
- `src/ui/theme/workoutsLegacyTheme.ts` — re-export shim. Both creator and editor use this for theme imports.

**Stub routes** that you'll replace:

- `app/(app)/coming-soon.tsx` — generic placeholder. The list track routes Create / Edit / Start / Upgrade CTAs here. Your job replaces the Create + Edit redirects with real routes; Start (M3) and Upgrade (M10) stay on `coming-soon`.

## What you're building (in scope)

### 1. Components to port verbatim from `persistence-mobile/components/workouts/`

Paste JSX + StyleSheet unchanged, swap `@/constants/theme` → `@/ui/theme/workoutsLegacyTheme`. Same discipline as the list track. No redesign, no Tamagui primitives, no "improvements." If you're tempted, write `// TODO(M11): <note>` and move on.

| Legacy file                                                       | LOC | V2 destination                                                           |
| ----------------------------------------------------------------- | --- | ------------------------------------------------------------------------ |
| `components/workouts/AddExercisePopover/AddExercisePopover.tsx`   | 261 | `src/ui/components/workouts/AddExercisePopover/AddExercisePopover.tsx`   |
| `components/workouts/AddExercisePopover/AddExerciseList.tsx`      | 57  | `src/ui/components/workouts/AddExercisePopover/AddExerciseList.tsx`      |
| `components/workouts/AddExercisePopover/AddExerciseListItem.tsx`  | 74  | `src/ui/components/workouts/AddExercisePopover/AddExerciseListItem.tsx`  |
| `components/workouts/AddExercisePopover/ExerciseDetailsModal.tsx` | 460 | `src/ui/components/workouts/AddExercisePopover/ExerciseDetailsModal.tsx` |
| `components/workouts/AddExercisePopover/styles.ts`                | 168 | `src/ui/components/workouts/AddExercisePopover/styles.ts`                |
| `components/workouts/ExerciseConfigCard/ExerciseConfigCard.tsx`   | 318 | `src/ui/components/workouts/ExerciseConfigCard/ExerciseConfigCard.tsx`   |
| `components/workouts/ExerciseConfigCard/styles.ts`                | 58  | `src/ui/components/workouts/ExerciseConfigCard/styles.ts`                |

**Critical:** the legacy `AddExercisePopover` uses `useGetExercises` + `useGetExerciseDetails` hooks for its inner exercise list. **Do NOT port those hooks.** Instead, wrap M0's `ExerciseListContainer` (already in V2 at `src/ui/containers/ExerciseListContainer.tsx`) inside the popover as the inner list view. This is the only structural deviation from verbatim — and it's the correct one because M0 already built the V2 exercise picker. Document it inline with a comment.

### 2. Containers + presenters + screens

Mirror the list-track architecture (3-memo container pipeline + pure presenter):

```
src/ui/containers/WorkoutCreatorContainer.tsx    (form reducer + submit)
src/ui/containers/WorkoutEditorContainer.tsx     (async-load via useWorkout, dirty flag)
src/ui/presenters/WorkoutCreatorPresenter.tsx    (legacy form layout)
src/ui/presenters/WorkoutEditorPresenter.tsx     (same form, pre-populated)
app/(app)/workouts/create.tsx                    (modal stack: <WorkoutCreatorContainer />)
app/(app)/workouts/[id]/edit.tsx                 (modal stack: <WorkoutEditorContainer />)
```

The creator + editor share most of the form layout. Pull the shared bits into a `WorkoutFormPresenter` component if it cleans up — but only if it stays a faithful port of the legacy form. Don't refactor for refactor's sake.

### 3. Wire the routes

Replace these `coming-soon` redirects in `WorkoutsListContainer.tsx`:

```tsx
// BEFORE (in PR #40):
const onCreateWorkout = useCallback(() => {
  router.push("/coming-soon?feature=workout-creator" as never);
}, []);

const onEditWorkout = useCallback((workout: { id: string }) => {
  void workout;
  router.push("/coming-soon?feature=workout-editor" as never);
}, []);

// AFTER (your PR):
const onCreateWorkout = useCallback(() => {
  router.push("/(app)/workouts/create" as never);
}, []);

const onEditWorkout = useCallback((workout: { id: string }) => {
  router.push(`/(app)/workouts/${workout.id}/edit` as never);
}, []);
```

`coming-soon.tsx` itself stays — the active-session and subscription routes still need it.

### 4. Tests (minimum)

- **AddExercisePopover** — multi-select toggle, "Add as exercises" / "Add as superset" CTAs, exercise-detail drill-in.
- **ExerciseConfigCard** — sets/reps/rest editing, superset shared-field propagation, remove-exercise.
- **WorkoutCreatorContainer** — happy path (form → validate → `createWorkoutCommand` → success), validation surfacing on submit, dirty-form discard prompt.
- **WorkoutEditorContainer** — async load, full-replacement PATCH, dirty flag accuracy, route param.
- **Presenters** — render branches for empty / populated / error / saving states.

Aim for 90% global aggregate (mobile package's threshold). Per-file dips are OK if the aggregate holds — see learning #3 below.

## Acceptance criteria (from parent spec)

Closes:

- `04-workout-management/requirements.md` STORY-002 ACs 2.1–2.12 (creator)
- `04-workout-management/requirements.md` STORY-003 ACs 3.1–3.4 (supersets — most of the visible UX lives in the creator/editor)
- `04-workout-management/requirements.md` STORY-004 ACs 4.1–4.8 (editor)
- `04-workout-management/requirements.md` STORY-006 AC 6.5 (visibility selector inside the editor)

After merge, `tasks.md` Phase 7 ticks. Phase 8 (smoke) is run end-to-end against `bun run sst dev`.

## Out of scope (don't pull in)

- **Active-session screens** — M3. Start CTA stays on `/coming-soon?feature=active-session`.
- **Drag-and-drop reorder** — M11 polish. Legacy doesn't ship it; sortOrder is implicit on add.
- **Soft-delete** — deferred follow-up per `tasks.md` Phase 10.
- **Exercise-creation flow inside the picker** — M5. The picker re-uses M0's `ExerciseListContainer`; if the legacy popover has a "Create exercise" inline CTA, route it to `/coming-soon?feature=exercise-creator` (and add a config entry in `coming-soon.tsx`).
- **Subscription enforcement on quota** — M10 owns gating. The `WorkoutLimitIndicator` already plumbs `quota.used / quota.limit` from the list response; that's enough for M2.

## M2 learnings to apply (do NOT re-discover)

These were paid for in PRs #39 + #40. Burned a CI cycle each.

1. **Verbatim port + view-mapping container.** Legacy components type props as `any` and read snake_case (`is_assigned`, `targeted_muscles`, `created_by`, `target_sets`, `target_reps_min/max`). V2 emits camelCase. Pattern: paste component verbatim, container builds a `toCardView(workout)` adapter that maps V2 → legacy shape. Never change the component to consume camelCase — that breaks the verbatim discipline. For the creator/editor: the form reducer lives in V2 camelCase (matching `CreateWorkoutInput`); the `ExerciseConfigCard` consumes a legacy-shaped view-model (snake_case + `target_sets`, etc.) which the container builds. Write a `toExerciseConfigCardView(workoutExercise, allExercisesInForm)` helper.

2. **`/coming-soon` route exists already.** Don't add new placeholder routes — extend the `COPY` map in `app/(app)/coming-soon.tsx` if you need a new feature label.

3. **Coverage threshold is GLOBAL aggregate**, not per-file. `package.json`'s `coverageThreshold.global` is the only gate. Individual files can dip below 90% as long as the aggregate holds. Don't burn cycles writing speculative tests for legacy branches that aren't worth exercising — the aggregate has plenty of headroom.

4. **`jest.clearAllMocks()` does NOT reset mock implementations.** If your tests install spies (`jest.spyOn(...).mockImplementation(...)`), add `afterEach(jest.restoreAllMocks)` so they don't leak across tests. The list-track CI flake came from a leftover `Alert.alert` spy.

5. **`jest.mock()` factory variable names must be `mock`-prefixed.** `const mockRouterPush = jest.fn(); jest.mock(..., () => ({ push: mockRouterPush }))` works. Plain `routerPush` triggers a hoisting error from jest's parser.

6. **Re-export-only files (`export { x } from "./y"`) register 0% coverage.** Istanbul can't instrument them. For coverable shims, use local aliases: `import { x as _x } from "./y"; export const x = _x;`. The `workoutsLegacyTheme.ts` carries the live example. If you add another shim file, follow the same pattern.

7. **Validation defaults consistency.** When the repo applies `?? 1` defaults on insert, the handler validation must check the bounds against the SAME defaults. Otherwise a payload like `{ targetRepsMin: 5 }` passes validation but stores `min=5/max=1`. The shared helper `findInvalidRepRangeIndex` in `microservices/core/src/application/workouts/shared/schemas.ts` resolves bounds before checking; do the same on the mobile-side validation if you add new client-side checks. (The current `validateWorkoutInput` already handles this correctly — verify before adding new rules.)

8. **TOCTOU on ownership-checked mutations.** PATCH/DELETE handlers fold ownership into the WHERE clause: `where(and(eq(id), eq(createdBy, userId)))`. Empty `returning()` → not-found-or-not-owner → 404. No separate SELECT, no race window. The mobile-side commands don't need this (they're storage-only) — but if you ever add a direct API call from a command, mirror the pattern.

9. **Test stabilisation pattern: anchor on a cache-derived element first.** Tests that rely on the auth bootstrap → setSnapshot → memo chain can race against `findByText`'s 4500ms timeout in CI. Anchor by waiting for an element you know will appear from the cache, then interact:

   ```ts
   expect(await findByText("Push Day")).toBeTruthy(); // anchor — proves cache propagated
   fireEvent.press(await findByText("Edit")); // then interact
   ```

   For cases where even this might race in a loaded CI worker, pass an explicit timeout as the third arg to `it()`: `it("...", async () => {...}, 30_000)`.

10. **The Popover wrapper at `src/ui/components/Popover.tsx`** wraps `Modal` with `transparent + animationType="fade"`. Returns `null` when `visible={false}`. Has `header`, `content`, `footer` slots and a `close-button` testID. Reusable for any modal-style sheet — the `AddExercisePopover` should compose it.

## Coordinate

If you discover a wire-format gap or need a backend tweak, raise it in the PR description and ping in Slack rather than silently bridging client-side. The backend contract in `04-workout-management/design.md § API Contract` is binding.

## Reference: what the previous slice looked like

PR #40 final state for reference. Branch: `feat/m2-mobile-workouts`. 7 commits, ~6500 LOC. Tests: 790 mobile / 90 suites. Coverage aggregate above 90 / 90 / 90 / 90 globally. CI flake fixes in commits `b51977e` + `63e3d75` are worth scanning if you hit similar timing issues.

Good luck. Bias toward shipping, not perfecting.
