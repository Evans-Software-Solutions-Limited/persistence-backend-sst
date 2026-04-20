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

---

## Phase 7b — Backend writes + visibility (M0, backend track)

Parent milestone: [`specs/milestones/M0-integration-baseline/BACKEND_BRIEF.md`](../milestones/M0-integration-baseline/BACKEND_BRIEF.md).
Every item traces to a `design.md` section and an AC.

### Repository layer (`microservices/core/src/application/repositories/exerciseRepository.ts`)

- [ ] **7b.1** Add `create(userId, input)` — insert with `created_by = userId`, return inserted row
      (Spec: design.md § POST /exercises · AC 7.3)
- [ ] **7b.2** Add `update(userId, id, patch)` — scoped update `WHERE id = ? AND created_by = userId`; returns null if no row matched (handler translates to 404)
      (Spec: design.md § PATCH /exercises/:id · AC 7.4)
- [ ] **7b.3** Add `delete(userId, id)` — scoped hard delete; returns affected-row count
      (Spec: design.md § DELETE /exercises/:id · AC 7.5)
- [ ] **7b.4** Extend `list(filters)` — accept array filters (`targetedMusclesAny: string[]`, `equipmentAny: string[]`, `category: string[]`, `difficultyLevel: string[]`, `createdByFilter: string[]`), use Drizzle `inArray` / array overlap for OR-within-axis
      (Spec: design.md § GET /exercises · AC 7.6)
- [ ] **7b.5** Add visibility predicate to `list()` + `getById()` — always applied; system (`created_by IS NULL`) ∪ own (`= sub`) ∪ connected-PT (JOIN `pt_client_relationships`)
      (Spec: design.md § Backend Authorization Rules · AC 7.8)
- [ ] **7b.6** Translate `createdByFilter` enum values to predicates at repository boundary
      (Spec: design.md § Backend Authorization Rules · AC 7.7)

### Handlers (`microservices/core/src/application/exercises/`)

- [ ] **7b.7** Create `create/exercisesCreateHandler.ts` — JWT-auth, body validation, call `repo.create(sub, input)`, return 201
      (Spec: design.md § POST /exercises · AC 7.3)
- [ ] **7b.8** Create `update/exercisesUpdateHandler.ts` — JWT-auth, partial-body validation, call `repo.update(sub, id, patch)`; null-return → 404
      (Spec: design.md § PATCH /exercises/:id · AC 7.4)
- [ ] **7b.9** Create `delete/exercisesDeleteHandler.ts` — JWT-auth, call `repo.delete(sub, id)`; zero affected → 404; return 204
      (Spec: design.md § DELETE /exercises/:id · AC 7.5)
- [ ] **7b.10** Extend `list/exercisesListHandler.ts` query schema to the wire-format `t.Object` shown in design.md; pass JWT sub through to repo (optional — public list still works without auth)
      (Spec: design.md § GET /exercises · AC 7.6, AC 7.7)
- [ ] **7b.11** Reject `created_by` values requiring auth when JWT absent — return 400 with `{ error: "created_by filter value requires authentication" }`
      (Spec: design.md § Backend Authorization Rules · AC 7.7)
- [ ] **7b.12** Wire new handlers into `microservices/core/src/api.ts`

### Tests

- [ ] **7b.13** Handler tests for create/update/delete happy paths, 401, 404-not-403 on non-owner, validation failures
      (Spec: AC 7.3, 7.4, 7.5)
- [ ] **7b.14** List-handler tests: multi-axis OR-within / AND-across, `created_by=mine|system|pt|physio|all` partitioning, auth-required failure modes
      (Spec: AC 7.6, 7.7)
- [ ] **7b.15** Visibility tests: three-user fixture (user A, user B, PT C connected to A). Assert user A sees: own + system + PT C's customs; never B's customs. User B sees own + system; never A's or PT C's. `GET /exercises/:id` on invisible row → 404.
      (Spec: AC 7.8)
- [ ] **7b.16** Reference-list shape regression test — pin the exact response shape for muscle-groups/equipment/categories
      (Spec: AC 7.9)

### Quality gates

- [ ] **7b.17** All backend quality gates pass (prettier / typecheck / lint / build / test with 90% coverage on changed files)
      (Spec: repo CLAUDE.md PR Checklist)

---

## Phase 7c — Reference-list cache + legacy modal port + sync fix (M0, frontend track)

Parent milestone: [`specs/milestones/M0-integration-baseline/FRONTEND_BRIEF.md`](../milestones/M0-integration-baseline/FRONTEND_BRIEF.md).
Every item traces to a `design.md` section and an AC.

### Domain

- [ ] **7c.1** Add `ReferenceEntry`, `ReferenceListKind`, `ReferenceList` to `src/domain/models/reference-list.ts`; export from `domain/models/index.ts`
      (Spec: design.md § Reference-List Cache > Domain model · AC 7.10)
- [ ] **7c.2** Add `videoUrl`, `thumbnailUrl` to `Exercise` + `CreateExerciseInput` in `src/domain/models/exercise.ts`
      (Spec: design.md § Exercise Domain — M0 field additions · AC 7.16)

### Ports

- [ ] **7c.3** Extend `ApiPort` with `getReferenceList(kind)`
      (Spec: design.md § Reference-List Cache > Port extensions · AC 7.10)
- [ ] **7c.4** Extend `StoragePort` with `getCachedReferenceList / cacheReferenceList / getReferenceListAge`
      (Spec: design.md § Reference-List Cache > Port extensions · AC 7.10)

### Application

- [ ] **7c.5** Implement `getReferenceListQuery` + `refreshReferenceList` in `src/application/queries/reference-lists.query.ts`
      (Spec: design.md § Reference-List Cache > Application query · AC 7.10, 7.14)
- [ ] **7c.6** Update `createExerciseCommand` to call `mapCreateExerciseInputToApi` at enqueue time; store snake_case payload in sync-queue
      (Spec: design.md § Sync-Queue Wire Format · AC 7.15)

### Adapters

- [ ] **7c.7** Implement `SSTApiAdapter.getReferenceList(kind)` — dispatches to `/exercises/{muscle-groups|equipment|categories}`; maps categories `string[] → ReferenceEntry`
      (Spec: design.md § Reference-List Cache · design.md § Backend Endpoints > Reference-list endpoints · AC 7.10)
- [ ] **7c.8** Rewrite `SSTApiAdapter.buildExerciseQueryParams` to the legacy wire format (repeated-key arrays, UUID translation via reference cache, `q` param, drop cursor for offset)
      (Spec: design.md § Backend Endpoints > GET /exercises · AC 7.13)
- [ ] **7c.9** Add `mapEnumToUuid(kind, key, cache)` helper; log + skip unknown keys rather than throw
      (Spec: design.md § Reference-List Cache > Enum ↔ UUID bridge · AC 7.13)
- [ ] **7c.10** Update `refreshExerciseCache` pagination to offset-based (not cursor-based)
      (Spec: design.md § Backend Endpoints > GET /exercises · AC 7.13)
- [ ] **7c.11** SQLite adapter: add `reference_lists` table migration + implement three new `StoragePort` methods
      (Spec: design.md § Reference-List Cache > SQLite schema · AC 7.10, 7.14)
- [ ] **7c.12** InMemory adapters: matching stub implementations for `getReferenceList` and the three storage methods
      (Spec: design.md § Reference-List Cache · AC 7.10)

### UI — hooks + containers + presenters

- [ ] **7c.13** `src/ui/hooks/useReferenceLists.tsx` — reads cache, refreshes on first call per session, returns `{ muscleGroups, equipment, categories, isLoading, isStale, refresh }`
      (Spec: design.md § UI Hooks · AC 7.10)
- [ ] **7c.14** Delete `app/(app)/exercises/filters.tsx` (Phase 4 flat modal)
      (Spec: design.md § Hierarchical Filter Modal · AC 7.11)
- [ ] **7c.15** Create `app/(app)/exercises/filters/_layout.tsx` — modal shell + sticky Apply bar with live count
      (Spec: design.md § Hierarchical Filter Modal > Sticky Apply bar · AC 7.11, 7.12)
- [ ] **7c.16** Create `app/(app)/exercises/filters/index.tsx` — section list for 4 axes
      (Spec: design.md § Hierarchical Filter Modal > Route structure · AC 7.11)
- [ ] **7c.17** Create `app/(app)/exercises/filters/muscles.tsx` + `equipment.tsx` — searchable checklist per axis (port legacy `FilterDetailScreen`)
      (Spec: design.md § Hierarchical Filter Modal > Search UX · AC 7.11)
- [ ] **7c.18** Create `app/(app)/exercises/filters/difficulty.tsx` + `created-by.tsx` — plain checklist per axis
      (Spec: design.md § Hierarchical Filter Modal > Route structure · AC 7.11)
- [ ] **7c.19** Remove Phase 4 `ExerciseFiltersPresenter` / `ExerciseFiltersContainer` / `ExerciseFilterBar` wholesale; update `ExerciseListContainer` to consume the nested-modal output
      (Spec: design.md § Hierarchical Filter Modal > Presenter replacement · AC 7.11)
- [ ] **7c.20** Port exercise list card + delete-alert pattern from `persistence-mobile/components/exercises/*` 1:1; wire `DELETE /exercises/:id` via `ApiPort.deleteExercise`
      (Spec: design.md § Hierarchical Filter Modal > Legacy reference paths · AC 7.17)
- [ ] **7c.21** Add minimal `__DEV__`-gated creator form to `app/(app)/exercises/create.tsx` — name + primary muscle + equipment; wired through `createExerciseCommand`; gated so production bundle excludes the form
      (Spec: design.md § Sync-Queue Wire Format · AC 7.18)

### Tests

- [ ] **7c.22** Reference-list query tests (cache-hit, cache-miss, stale-trigger-refresh, API-failure fallback to cache)
      (Spec: AC 7.10, 7.14)
- [ ] **7c.23** Adapter tests for `getReferenceList` and the rewritten `buildExerciseQueryParams` — assert exact wire-format shape against snapshots
      (Spec: AC 7.13)
- [ ] **7c.24** SQLite adapter test: `reference_lists` table persistence across instances
      (Spec: AC 7.10, 7.14)
- [ ] **7c.25** `useReferenceLists` hook test: first-call refresh, subsequent reads hit cache
      (Spec: AC 7.10)
- [ ] **7c.26** Shallow render tests for the 4 nested filter screens (route registration, axis props)
      (Spec: AC 7.11)
- [ ] **7c.27** Apply-bar live-count test (sticky across navigation, correct count)
      (Spec: AC 7.12)
- [ ] **7c.28** `createExerciseCommand` test — asserts enqueued payload is snake_case wire shape, not domain shape
      (Spec: AC 7.15)
- [ ] **7c.29** Delete-alert test — destructive confirm fires `deleteExercise`, cache invalidates on success
      (Spec: AC 7.17)

### Quality gates

- [ ] **7c.30** All mobile quality gates pass (prettier / typecheck / lint 0-warn / build / test with 90% coverage on changed files)
      (Spec: repo `_agent.md` § Quality Gates)
