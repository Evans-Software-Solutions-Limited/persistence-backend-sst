# M0 — Frontend Agent Brief

You are implementing the frontend track of Milestone 0 — Integration Baseline. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the Expo + Tamagui mobile app at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/packages/mobile/`. You are NOT touching the SST backend — that is the backend agent's responsibility. You may read backend code for contract context but must not modify it.

## Authority

- Parent spec: [`../../03-exercise-library/`](../../03-exercise-library/) — Phase 4 already shipped; you are closing drift + preparing the write path.
- Mobile architectural rules: [`../../_agent.md`](../../_agent.md) — hexagonal arch, container/presenter, V2 tokens canonical.
- If the brief is silent, the parent spec wins. If the parent spec is silent, surface the gap before shipping.

## Scope

### 1. Reference-list cache (the foundation everything else depends on)

Add a new cross-feature reference cache so mobile can translate between its string enums and the backend's UUID catalog. This module will be reused for goal types, measurement types, etc. in later milestones — design for reuse.

**Domain model** — new file `packages/mobile/src/domain/models/reference-list.ts`:

```ts
export type ReferenceEntry = {
  id: string; // UUID from backend
  key: string; // Canonical enum string (e.g. "chest", "barbell")
  displayName: string; // Human label
};

export type ReferenceListKind = "muscle_groups" | "equipment" | "categories";

export type ReferenceList = {
  kind: ReferenceListKind;
  entries: ReferenceEntry[];
  syncedAt: string; // ISO timestamp
};
```

**Port extensions:**

- `ApiPort.getReferenceList(kind: ReferenceListKind): Promise<Result<ReferenceEntry[], ApiError>>` — calls `GET /exercises/muscle-groups` / `/equipment` / `/categories` depending on `kind`.
- `StoragePort.getCachedReferenceList(kind) → ReferenceList | null`
- `StoragePort.cacheReferenceList(kind, entries) → void`
- `StoragePort.getReferenceListAge(kind) → string | null`

**Storage**: new SQLite table `reference_lists` with columns `(kind TEXT PK, entries TEXT JSON, synced_at TEXT)`. Add migration in the SQLite adapter. Implement `InMemoryStorageAdapter` methods for tests.

**Application query** — new file `packages/mobile/src/application/queries/reference-lists.query.ts`:

```ts
export const REFERENCE_LIST_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function getReferenceListQuery(
  storage: StoragePort,
  kind: ReferenceListKind,
  now?: () => number,
): { entries: ReferenceEntry[]; isStale: boolean };

export async function refreshReferenceList(
  api: ApiPort,
  storage: StoragePort,
  kind: ReferenceListKind,
): Promise<Result<ReferenceEntry[], ApiError>>;
```

Cache-first semantics exactly like `getExercisesQuery`. 24h staleness.

### 2. Fix `SSTApiAdapter.buildExerciseQueryParams`

Current implementation at `packages/mobile/src/adapters/api/sst-api.adapter.ts` sends mobile enum strings as comma-joined params. Target shape (after backend agent extends the handler):

```ts
// current (broken)
if (filters?.muscleGroups) params.muscleGroups = filters.muscleGroups.join(",");

// target
if (filters?.muscleGroups?.length) {
  params.muscleGroup = filters.muscleGroups
    .map((key) => mapMuscleKeyToUuid(key, cache))
    .filter(Boolean)
    .join(",");
}
```

Add a `mapEnumToUuid(kind, key, cache)` helper that consults the reference-list cache. If the mapping fails (unknown key, cache empty), log + skip that filter with a console warning — don't throw.

**Params to send** (matches backend §4 in `BACKEND_BRIEF.md`):

- `muscleGroup` (comma-joined UUIDs)
- `difficulty` (comma-joined enum strings — no translation needed; backend accepts)
- `equipment` (comma-joined UUIDs via cache)
- `category` (single enum string as today)
- `createdBy` (`"mine"` or `"system"`)
- `search` (string)
- `limit` (number), `offset` (number)

**Drop**: `cursor` param — mobile `refreshExerciseCache` uses cursor-based pagination but backend does offset/limit. Update `refreshExerciseCache` to accept + pass `offset` instead, or adapt its pagination walker to synthesise offset from the page index.

### 3. Replace hardcoded enums in the filter modal

Current `ExerciseFiltersPresenter` (`packages/mobile/src/ui/presenters/ExerciseFiltersPresenter.tsx`) iterates `MUSCLE_GROUPS` and `EQUIPMENT_TYPES` constants. Replace with reference-list-driven props.

**Container update** — `ExerciseFiltersContainer`:

- Consume reference-list cache via a new `useReferenceLists()` hook
- Pass the entries to the presenter (keyed by UUID, labelled by backend's `displayName`)
- Apply filters converts UUIDs → enum keys for the shared `useExerciseFilters` state (so the list query continues to work, since domain `ExerciseFilters.muscleGroups` is `MuscleGroup[]` of enum strings)

**Presenter update** — `ExerciseFiltersPresenter` takes new props:

```ts
muscleOptions: ReferenceEntry[];
equipmentOptions: ReferenceEntry[];
difficultyOptions: ExerciseDifficulty[]; // still enum — no ref list needed
```

`MuscleGroupPicker` similarly consumes options, not the hardcoded enum.

### 4. Hierarchical filter modal (port from legacy)

The Phase 4 modal is a flat single-scroll sheet. The legacy app uses a section-list → detail-per-axis pattern (documented in `specs/milestones/M0-integration-baseline/BRIEF.md` and observed during the legacy audit). Port that pattern.

**New route structure** — inside `app/(app)/exercises/filters/`:

```
filters/
├── _layout.tsx           # Stack navigator inside the modal
├── index.tsx             # Section list: "Muscle Groups ›", "Equipment ›", "Difficulty ›"
├── muscles.tsx           # Searchable checklist of muscle-group chips
├── equipment.tsx         # Searchable checklist of equipment chips
└── difficulty.tsx        # Non-searchable checklist of difficulty chips
```

Current `filters.tsx` file deletes; replace with the nested structure. The modal outer shell (close button, title, apply bar) lives in `_layout.tsx`; the section screens render inside.

The sticky bottom `Show N exercises` bar remains — live count updates as the user navigates between sub-screens.

### 5. Wire `createExerciseCommand` sync-queue entry

The Phase 4 brief flagged that `processSyncQueue` raw-fetches `entry.payload` verbatim, bypassing `SSTApiAdapter.mapCreateExerciseInputToApi`. So enqueued domain-shaped payloads reach the server with the wrong field names.

**Two options; pick one in the PR:**

A. **Map at enqueue time.** `createExerciseCommand` runs `mapCreateExerciseInputToApi` before enqueueing, storing the wire-format payload directly. Simpler; sync-queue stays dumb.

B. **Map at flush time.** `processSyncQueue` dispatches on `entityType` and calls the adapter's mapper. More flexible; but couples the sync engine to domain knowledge.

Recommend option A for M0. Document the decision in the PR body.

### 6. Optional dev creator hook (for smoke testing only)

M0 doesn't ship a creator screen (that's M5). But the smoke test needs to exercise `POST /exercises`.

Add a one-off dev action — a "Create test exercise" button that only renders when `__DEV__ === true`, perhaps in the Profile tab or inside the filter modal footer. Wires through `createExerciseCommand` with a hardcoded test payload. Gated so it ships disabled in production builds.

Alternative: add to the existing `app/(app)/exercises/create.tsx` placeholder a minimal form for name + muscle group, enough to test the write path. M5 replaces it wholesale.

Pick whichever is cheaper; just make sure the smoke test can execute a create.

### 7. Files you will touch

**Domain:**

- `packages/mobile/src/domain/models/reference-list.ts` — NEW
- `packages/mobile/src/domain/models/index.ts` — export new model
- `packages/mobile/src/domain/ports/api.port.ts` — `getReferenceList` signature
- `packages/mobile/src/domain/ports/storage.port.ts` — reference list cache methods

**Application:**

- `packages/mobile/src/application/queries/reference-lists.query.ts` — NEW

**Adapters:**

- `packages/mobile/src/adapters/api/sst-api.adapter.ts` — fix filter params + add `getReferenceList`
- `packages/mobile/src/adapters/api/__tests__/in-memory-api.adapter.ts` — test stub for `getReferenceList`
- `packages/mobile/src/adapters/storage/sqlite.adapter.ts` — reference-list table migration + method impls
- `packages/mobile/src/adapters/storage/__tests__/in-memory-storage.adapter.ts` — method stubs

**UI:**

- `packages/mobile/src/ui/hooks/useReferenceLists.tsx` — NEW
- `packages/mobile/src/ui/containers/ExerciseFiltersContainer.tsx` — consume reference-list hook
- `packages/mobile/src/ui/presenters/ExerciseFiltersPresenter.tsx` — options-based props
- `packages/mobile/src/ui/components/MuscleGroupPicker.tsx` — options-based props
- `app/(app)/exercises/filters.tsx` — DELETE, replaced by:
- `app/(app)/exercises/filters/_layout.tsx` — NEW
- `app/(app)/exercises/filters/index.tsx` — NEW (section list)
- `app/(app)/exercises/filters/muscles.tsx` — NEW
- `app/(app)/exercises/filters/equipment.tsx` — NEW
- `app/(app)/exercises/filters/difficulty.tsx` — NEW

**Tests:**

- Reference-list query tests (staleness, cache-hit, cache-miss, API failure fallback)
- Adapter tests for new `getReferenceList` and the fixed `buildExerciseQueryParams`
- Container test update for `ExerciseFiltersContainer` (options-driven, apply flow)
- Presenter tests updated to use options props
- New tests for the 4 nested filter routes (shallow render sanity)

## Files you must NOT touch

- Anything under `microservices/core/` — backend agent territory.
- Other feature-area presenters (home, workouts, progress, profile).
- `packages/mobile/app/(app)/(tabs)/*` except exercises — no tab-bar changes.

## Quality gates (must pass before PR opens)

- `bun run prettier:check`
- `bun run typecheck` (both `@persistence/mobile` and the router typed-routes via `.expo/types/router.d.ts` may need regeneration after adding the nested routes)
- `bun run lint` — 0 errors, 0 warnings in `@persistence/mobile`
- `bun run build`
- `bun run test:unit` — 90% coverage on changed files

## Output expected

- A PR on branch `feat/m0-mobile-reference-lists` (branched from fresh `main`)
- PR title: `feat(mobile): reference-list cache + filter wire format + hierarchical modal (M0)`
- PR body ends with a `### How to view` block:
  - Branch checkout
  - `bun install` if needed (SQLite migration)
  - `bun run dev` in one terminal (backend)
  - `cd packages/mobile && bun run start` in another
  - Sign in → Exercises tab → open filter modal → navigate muscles/equipment/difficulty → apply → verify filtering
- Mark the Phase 7 tasks in `specs/03-exercise-library/tasks.md` that your work completes.

## Blocking questions (answer before shipping)

1. **Reference-list refresh trigger** — on app foreground (like exercise cache), on first Exercises-tab open, or on first filter-modal open? First-tab-open is cheapest; app-foreground matches sync-engine philosophy. Decide and document.
2. **What happens if a user has cached exercises referencing an enum that's since been removed from the backend catalog?** — filter probably just shows 0 matches. Log a warning; acceptable edge case.
3. **Nested modal routes + bottom action bar** — Expo Router supports nested stacks in modals. Confirm the sticky apply bar survives child-route changes (might need a parent-level layout handler). If it's fiddly, fall back to rendering the apply bar inside each child screen, but that's duplication.

## Non-goals

- No exercise detail screen (M5).
- No exercise creator form beyond the optional dev hook (M5).
- No visual redesign of existing cards / chips (M11 polish).
- No new domain enums — reference lists sit alongside the existing `MuscleGroup`/`EquipmentType` string enums and translate via the cache.

## Success criteria

Your PR is mergeable when:

1. Reference-list cache is populated on first launch (seen in SQLite).
2. Filter modal navigates as section list → detail screens; live count updates across navigation.
3. Apply filters against `bun run dev`, confirm the actual HTTP request sends backend-shaped UUIDs (inspect with network logs).
4. Dev creator hook successfully `POST /exercises`, row visible in Postgres, appears in "My Exercises" quick filter.
5. Quality gates pass.
6. Backend agent's smoke test can execute against your branch.
