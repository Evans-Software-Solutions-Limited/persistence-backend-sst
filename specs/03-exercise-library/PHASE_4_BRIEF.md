> **Historical reference.** This brief drove the Phase 4 work that shipped in April 2026; preserved here for historical reference. Current M0 work is briefed in [`../milestones/M0-integration-baseline/BRIEF.md`](../milestones/M0-integration-baseline/BRIEF.md) and (when authored) its sibling `BACKEND_BRIEF.md` + `FRONTEND_BRIEF.md`.

# Phase 4 Kickoff: Exercise Library — List UI

## Read first

1. Memory: `project_current_state.md` (mobile app current state, post Phase 3 merge)
2. `specs/_agent.md` (hexagonal architecture, container/presenter, quality gates)
3. `specs/03-exercise-library/{requirements.md,design.md,tasks.md}` — Phase 4 checklist
4. `feedback_design_quality.md` + `feedback_frontend_design_skill.md` in user memory — premium gym aesthetic; ALWAYS run `/frontend-design` skill on every screen.

## Where Phases 1–3 left things

**All merged to main.** 357 tests, 99.39% lines / 93.97% branches. The backend layers for exercises are complete and tested:

- **Domain** (`src/domain/`)
  - `models/exercise.ts` — `Exercise`, `ExerciseFilters`, `CreateExerciseInput`, enums (`ExerciseCategory`, `ExerciseDifficulty`, `MuscleGroup`, `EquipmentType`), display label maps (`MUSCLE_GROUP_LABELS`, `EQUIPMENT_LABELS`, `CATEGORY_LABELS`, `DIFFICULTY_LABELS`).
  - `services/exercise.service.ts` — `filterExercises(exercises, filters)` with relevance ranking, `validateExerciseInput(input)`.

- **Ports & adapters** (`src/domain/ports/`, `src/adapters/`)
  - `ApiPort.getExercises(filters?, cursor?) → PaginatedResult<Exercise>`, `getExercise`, `createExercise`, `updateExercise`, `deleteExercise`.
  - `StoragePort.getCachedExercises(filters?)`, `cacheExercises`, `getCachedExercise`, `getExerciseCacheAge`, `saveCustomExercise`.
  - SST + SQLite + InMemory implementations all done.

- **Application layer** (`src/application/`)
  - `queries/exercises.query.ts`:
    - `getExercisesQuery(storage, filters?, now?) → { exercises, lastSyncedAt, isStale }` — sync cache read. `isStale` is derived from `last_synced_at` (NOT row timestamps), so a progressive cache from a failed/truncated refresh still reports stale.
    - `getExerciseQuery(api, storage, id)` — cache-first single lookup.
    - `refreshExerciseCache(api, storage, filters?)` — paginated walk with `REFRESH_MAX_PAGES=100` safety. Returns api/server error if truncated; `last_synced_at` only set on full completion.
  - `commands/create-exercise.command.ts`:
    - `createExerciseCommand({storage, generateId, userId}, input)` — validates → sanitizes once → saves to local cache with `local-{id}` prefix → enqueues POST /exercises sync mutation. Never awaits network.

## Phase 4 scope (from `tasks.md`)

- [ ] `ExerciseCard` presenter (name, primary muscle group, equipment, category badge, custom-exercise indicator)
- [ ] `ExerciseFilterBar` presenter (filter chips, active state, clear all)
- [ ] `MuscleGroupPicker` presenter (multi-select grid)
- [ ] `ExerciseListPresenter` (search bar, filter bar, list, empty/loading states, stale indicator)
- [ ] `ExerciseListContainer` (manages search state with 300ms debounce, filters, calls `getExercisesQuery` + `refreshExerciseCache`, pull-to-refresh)
- [ ] `app/(app)/exercises/index.tsx` screen (thin wrapper)
- [ ] Presenter tests (renders exercises, filters, empty state, custom badge)
- [ ] Container integration test (fetches and displays via `InMemoryStorageAdapter` + `InMemoryApiAdapter`)

## Architectural decisions already made (don't relitigate)

1. **Local-first search.** Filtering runs over cached SQLite exercises via `filterExercises`. The mobile client never calls Algolia directly — backend may proxy it, but the UI just consumes the SST API.
2. **Battery-efficient sync.** No polling. `refreshExerciseCache` triggers ONLY on: app foreground, pull-to-refresh, or post-mutation (debounced).
3. **Cache-first reads.** `getExercisesQuery` returns cached data immediately; container kicks off `refreshExerciseCache` in the background when `isStale` is true.
4. **Stale indicator.** UI should show a subtle "last updated X ago" or warning banner when `lastSyncedAt` is null OR > 24h old. Use `lastSyncedAt` from the query result, not the row-level cache age.

## UI patterns to follow (already in this codebase)

- **Container/Presenter split.** Containers own hooks/state/mutations. Presenters take props only — no hooks, no side effects, no `useAdapters`.
- **Staggered enter animations.** Use the shared `useStaggeredEntry` hook at `src/ui/hooks/useStaggeredEntry.ts` for any screen with multiple sections.
- **Tamagui primitives.** `src/ui/components/` has Stack, Text, Button, Input, Card, Badge, Skeleton, EmptyState, ErrorState, Avatar, etc. Use these — don't reach for raw Tamagui components in feature code.
- **Skeleton loaders, not spinners.** Skeletons feel faster.
- **No magic strings for navigation.** Use Expo Router patterns from existing auth screens.

## Quality gates (must pass before PR)

```bash
# From monorepo root
bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit
```

- 90% coverage threshold (lines/branches/functions/statements). Non-negotiable.
- 0 lint warnings in `@persistence/mobile`.
- Add `jest.setTimeout(15_000)` on container test suites that trigger Tamagui compilation (the SignUpContainer pattern).
- Test files with `jest.mock()` before imports need `// eslint-disable-next-line import/first`.

## Workflow preferences

- Work on **main**, NOT in worktrees.
- Branch: `feat/exercises_phase_4`. Commit, push, open PR for review.
- Conventional commits (`feat(mobile): ...`, `fix(mobile): ...`).
- Run `/frontend-design` skill at least once on the list screen — premium gym aesthetic (Strong/Hevy/Fitbod feel).
- Take a simulator screenshot when the screen is up so the user can sanity-check the design pass.

## Outstanding side task — DO NOT TOUCH

A side task is in flight separately to fix the **sync engine wire-format drift**: `processSyncQueue` raw-fetches `entry.payload` verbatim, bypassing `SSTApiAdapter.mapCreateExerciseInputToApi`. So domain-shaped payloads enqueued by `createExerciseCommand` reach the server with the wrong field names (`primaryMuscleGroups` instead of `primaryMuscles`, etc.).

That work is being done on its own branch from main. The Phase 4 agent should:

- Not modify `sync.command.ts`, `createExerciseCommand`, or `mapCreateExerciseInputToApi`.
- Not depend on the side task being merged — Phase 4 UI uses `getExercisesQuery` (read path), and `createExerciseCommand` already has tests proving the local-cache flow works.
- If the side task lands first and changes the public shape of `createExerciseCommand` or its deps, just rebase.

## Test count baseline to beat

357 passing, 40 suites, 99.39% lines / 93.97% branches. Don't regress.

## Quick file map for Phase 4

```
packages/mobile/
├── app/(app)/exercises/
│   └── index.tsx                              # Phase 4: thin screen wrapper
├── src/ui/
│   ├── components/
│   │   ├── ExerciseCard.tsx                   # Phase 4: list item
│   │   ├── ExerciseFilterBar.tsx              # Phase 4: filter chips
│   │   ├── MuscleGroupPicker.tsx              # Phase 4: multi-select
│   │   ├── Skeleton.tsx                       # existing — use for loading
│   │   ├── EmptyState.tsx                     # existing — use for no results
│   │   └── index.ts                           # remember to barrel-export
│   ├── containers/
│   │   └── ExerciseListContainer.tsx          # Phase 4
│   ├── presenters/
│   │   └── ExerciseListPresenter.tsx          # Phase 4
│   └── hooks/
│       └── useStaggeredEntry.ts               # existing — use for enter anim
└── src/application/queries/exercises.query.ts # PHASE 3 — already done; just call it
```
