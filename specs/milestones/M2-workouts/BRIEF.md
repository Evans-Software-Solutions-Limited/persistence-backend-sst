# M2 — Workouts (list + create + edit)

## Why this milestone

M1 closed the Home tab. The next surface a user reaches for is the **Workouts tab** — currently a `<ComingSoon />` placeholder at [`packages/mobile/app/(app)/(tabs)/workouts.tsx`](<../../../packages/mobile/app/(app)/(tabs)/workouts.tsx>). Without it there's no way to manage workout templates, which gates everything in M3 (active sessions can't run without templates) and M4 (progress is meaningless without recorded workouts).

M2 ships the full workouts CRUD surface end-to-end:

1. **Backend nested-exercise wire-format.** The handlers for `GET /workouts`, `GET /workouts/:id`, `POST /workouts`, `PATCH /workouts/:id`, `DELETE /workouts/:id` already exist but are metadata-only and missing `supersetGroup` on the response. M2 extends them to handle nested `exercises[]` atomically (transaction on POST, full-replacement on PATCH), surfaces `supersetGroup`, adds the `quota` envelope on `type=mine`, and closes test gaps (two-user isolation, friends visibility, nested-exercise round-trips).
2. **Mobile list + creator + editor ported verbatim from legacy.** Three legacy screens (`app/(tabs)/workouts.tsx`, `app/workout-creator.tsx`, `app/workout-editor.tsx`) plus their supporting `components/workouts/*` set get pasted into V2 with the theme-shim swap only — same discipline as M1's Home port. No redesign.
3. **5-minute TTL offline cache + sync queue wiring.** Reads cache-first via two new SQLite tables (`cached_workouts` scoped by `(userId, type)`, `cached_workout_detail` scoped by `(userId, workoutId)`). Writes (create / update / delete) enqueue through `SyncQueuePort` with optimistic UI — same pattern M0 proved for exercises.
4. **Quota plumbing for `WorkoutLimitIndicator`.** List response carries `meta.quota = { used, limit }` for `type=mine`. M10 owns enforcement; M2 just renders.

This is the third milestone under the parallel-agent model. Same shape as M0 / M1 — two branches off `main`, spec-first commits, gated on a shared smoke test.

## The single most important rule (lift-and-shift discipline)

**Port the legacy UI verbatim.** Paste legacy JSX + StyleSheets in unchanged, swap theme imports for the V2 compat shim. The first M1 attempt re-implemented Home sections with Tamagui primitives and looked flatter than legacy — verbatim paste fixed it. Same applies here: don't redesign anything during the port. Preserve legacy behaviour, transitions, spacing, and even quirks. Polish belongs in M11.

If you find yourself thinking "this could be cleaner" during the port — stop and write `// TODO(M11): <brief note>` in place. Move on. Don't pick "better" Tamagui primitives, don't tweak transitions, don't refactor the layout, don't re-implement the carousel mode.

## Parent specs

- [`../../04-workout-management/`](../../04-workout-management/) — all M2 work cites this spec.
- Updated commits 1–2 of each branch sequence with: corrected domain model (`targetRepsMin/Max`, `targetDurationSeconds`, `supersetGroup`), full API contract section, SQLite cache shape, offline strategy, STORY-001..009 acceptance criteria covering tabs / search / quota / superset propagation / dirty-form discard / two-user data isolation. See diff in the first commit on each branch.

## Spec alignment

This milestone closes these sections of the parent spec:

- `04-workout-management/design.md` § Domain Model, § API Contract (M2 backend), § SQLite cache shape, § Offline Strategy, § Visibility & access control
- `04-workout-management/requirements.md` STORY-001..009 (all M2-scoped ACs)
- `04-workout-management/tasks.md` Phases 1–8 (Phases 9 / 10 deferred to M11 / future)

## Scope summary

### Backend

- Add `supersetGroup` to the `WorkoutWithExercises.exercises[]` response shape; update `getById`'s select clause.
- Extend `WorkoutRepository.list` to embed nested `exercises[]` per workout (single grouped query) and to return total row count for pagination.
- Add `WorkoutRepository.getQuota(userId)`; surface in list envelope when `type=mine`.
- Refactor `WorkoutRepository.create` → atomic `createWithExercises` running both inserts in a Drizzle transaction.
- Refactor `WorkoutRepository.update` → support optional `exercises` full-replacement in a transaction.
- `default` filter excludes user's own public workouts.
- Handler-level tests: two-user isolation on every handler, friends-visibility positive path, nested-exercise mutation round-trips, superset assertions, quota envelope.
- **Double envelope on list** (`{ data, meta }`), **single envelope on detail / create / update** (`{ data }`), **204 on delete** — same as M0 conventions.

### Frontend

- New domain model `Workout` / `WorkoutExercise` / `WorkoutVisibility` / `WorkoutListType` / `WorkoutQuota` mirroring backend.
- `ApiPort` workout method signatures replace M1 stubs (nested exercises in create/update, quota in list response).
- New SQLite tables `cached_workouts` + `cached_workout_detail`; 5-min TTL via `WORKOUTS_LIST_STALE_AFTER_MS`.
- New application layer: `getWorkoutsQuery` (parallel three-section fetch), `getWorkoutQuery`, `createWorkoutCommand`, `updateWorkoutCommand`, `deleteWorkoutCommand`. Writes enqueue via `SyncQueuePort`.
- `useWorkouts` + `useWorkout(id)` hooks mirroring `useDashboard`'s shape (in-flight ref keyed on userId, stale-closure guards, AppState foreground refresh).
- Port `WorkoutCard` / `WorkoutSection` / `WorkoutPopover` / `WorkoutLimitIndicator` / `QuickActions` / `AddExercisePopover` (with `AddExerciseList` / `AddExerciseListItem` / `ExerciseDetailsModal`) / `ExerciseConfigCard` from legacy verbatim. New `workoutsLegacyTheme.ts` shim extending `homeLegacyTheme.ts`.
- New containers: `WorkoutsListContainer`, `WorkoutCreatorContainer`, `WorkoutEditorContainer`. Each follows the 3-memo pipeline (cachedPayload → viewModel → animationStyles).
- New routes: `(app)/workouts/create.tsx`, `(app)/workouts/[id]/edit.tsx`. Replace `(tabs)/workouts.tsx` `<ComingSoon />` with `<WorkoutsListContainer />`.
- M0 `ExerciseListContainer` is **reused inside** `AddExercisePopover` — do not reimplement search/pagination/filters.

## Success criteria (review gate)

Done when **all** of these pass against `bun run dev` on a real iOS simulator. Full walkthrough in [`SMOKE_TEST.md`](./SMOKE_TEST.md).

1. Sign in. Workouts tab renders three sections (Mine / Assigned / Default) from cached payload first, background refresh follows.
2. `WorkoutLimitIndicator` shows the user's `used / limit` quota; if no `subscriptions.workoutLimit` row exists, indicator is hidden.
3. Search filters across all three sections by name (case-insensitive substring).
4. Tap a card — `WorkoutPopover` opens with full exercise list, supersets visually grouped, owner sees Edit + Delete CTAs.
5. Create a new workout with three exercises (one standalone, two grouped as a superset). POST fires once with the full nested array. Server returns 201 with the saved workout. New row appears under Mine.
6. Edit the workout — change `targetSets` on the lead superset peer; field disabled on the other peer but mirrors the lead's value. Save fires PATCH with full-replacement `exercises[]`. Cached detail + list rows update.
7. Delete a workout — confirmation dialog, DELETE fires, row vanishes from list, cached rows removed. Sessions referencing this workout retain their rows with `workoutId = NULL`.
8. Pull-to-refresh on the list bypasses the 5-min TTL and refetches all three sections in parallel; `meta.quota` on the `mine` response updates the indicator.
9. Cold-start with cache present — list renders **instantly** from `cached_workouts` rows (no spinner), background refresh fires ~100 ms after mount.
10. Offline (airplane mode) cold-start — list renders from cache with last-synced caption; create / edit / delete attempts queue via `SyncQueuePort` and replay when online.
11. Two-user isolation: sign in as user B, verify user A's private workouts are absent from B's list and `GET /workouts/:idOfPrivateA` returns 404.

Plus the per-PR quality gates (prettier / typecheck / lint / build / test, 90% coverage on every changed file).

## Agent briefs

Two work tracks landing in a **single PR** for M2. Wire-format coupling between backend and frontend is tight (nested-exercise contract, quota envelope, supersetGroup), so the trade-off favoured one PR over two parallel ones to skip the rebase + re-smoke dance after the first merges. M0 / M1 used two PRs; this is a per-milestone call, not a model change.

- **Backend track:** [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md)
- **Frontend track:** [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md)
- **Smoke test:** [`SMOKE_TEST.md`](./SMOKE_TEST.md)

Single branch off fresh `main`: `feat/m2-workouts`. PR title: `feat: workouts list + create + edit (M2)`. Commit history preserves the per-track distinction — backend commits land first (spec, repo, handlers, tests), then mobile commits (domain, adapters, hooks, UI, tests). The 11-step smoke test runs against the merged branch.

The shared wire-format contract is documented in `04-workout-management/design.md § API Contract`.

## Explicit non-goals for M2

- **No active session.** "Start workout" CTAs render but route to `/coming-soon`. Real wiring is M3.
- **No drag-and-drop reorder.** Legacy doesn't ship it; STORY-002's drag-and-drop AC reclassified to M11 polish.
- **No soft-delete.** Hard delete + FK `set null` on sessions. Soft-delete is a deferred follow-up (`tasks.md` Phase 10).
- **No exercise creation flow.** Picker re-uses M0 `ExerciseListContainer`; the "Create exercise" CTA inside the picker (if ported) routes to M5 stub.
- **No workout programs.** `workout_programs` schema exists but no M2 surface touches it. M8 territory.
- **No trainer-side assignment writes.** M2 reads `workout_assignments` for the Assigned tab; write surface is M8.
- **No workout-detail standalone route.** Detail is a popover modal inline on the list, mirroring legacy.
- **No subscription-paywall enforcement on quota.** `WorkoutLimitIndicator` renders the count; M10 enforces.
- **No AI gym buddy / chat.** Out of M2.
- **No visual redesign / polish.** Verbatim port; M11 owns aesthetic refinement.

## Cross-cutting notes (carry into the briefs)

- **Verbatim port + theme shim.** Paste legacy JSX + StyleSheet unchanged, swap `Colors / Typography / Spacing / BorderRadius / Shadows` import path to `workoutsLegacyTheme.ts` (which extends `homeLegacyTheme.ts`). Don't redesign during the port.
- **3-memo container pipeline.** `cachedPayload` → `viewModel` → `animationStyles`. Same as `HomeContainer` / `ExerciseListContainer`. Form-keystroke inputs in the creator/editor stay out of the cache-read memo.
- **Stale-closure guards on session-scoped writes.** Any hook doing async writes tied to the signed-in user gates state + storage writes on `latestUserIdRef.current === userId`. M1 paid for this twice — do not re-discover.
- **`inFlightRef` keyed on userId.** Bare promise dedupe breaks on account switch. Use `{ userId, promise }`.
- **`useCallback` deps.** Lift stable methods off inline hook returns — depend on `workouts.refresh`, not on `workouts`.
- **Single-envelope discipline.** List is double-envelope `{ data, meta }`; detail / create / update are single-envelope `{ data }`; delete is 204. Don't double-wrap on the backend or double-unwrap on the frontend.
- **Sync queue.** Writes enqueue through `SyncQueuePort` with optimistic local-cache write. Server-issued IDs replace client-issued temp UUIDs on successful POST.

## Open decisions resolved in this brief pass

- **List response shape.** Includes nested `exercises[]` per workout (joined with exercise metadata). Heavier payload than metadata-only, but avoids N+1 on the list screen and matches what `WorkoutCard` needs to render. Single round-trip fetches the entire Workouts tab.
- **PATCH semantics for nested exercises.** Full-replacement when `exercises` is present in the body. Client sends desired final state; backend wipes + re-inserts in a transaction. Simpler than diff-and-apply and acceptable for M2 use cases.
- **Quota plumbing.** Bundled into the list envelope as `meta.quota` (only when `type=mine`). No separate endpoint. M10 will revisit when enforcement lands.
- **`default` filter semantics.** `visibility = 'public' AND createdBy != userId`. Excludes user's own public workouts (those show under Mine).
- **Active-session CTAs.** Render but route to `/coming-soon` placeholder route. Verbatim port preserves the button; M3 wires it.
- **Soft-delete.** Deferred. M2 hard-deletes; sessions retain `workoutId = NULL` via FK `set null`.
- **Drag-and-drop reorder.** Deferred to M11. Legacy doesn't have it; STORY-002 AC is aspirational.
