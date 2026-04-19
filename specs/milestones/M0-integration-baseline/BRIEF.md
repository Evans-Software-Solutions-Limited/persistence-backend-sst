# M0 — Integration Baseline

## Why this milestone

We shipped Phase 4 of the Exercise Library in April 2026 against in-memory adapters. It looks complete in the simulator against stubs — but three gaps mean it does **not** work end-to-end against the real SST backend:

1. **Write-path is broken at the backend.** Mobile calls `POST /exercises`, `PATCH /exercises/:id`, `DELETE /exercises/:id` through `SSTApiAdapter`; the backend has no matching handlers. Creating a custom exercise 404s.
2. **Read-path is broken at the wire format.** Mobile's `ExerciseFilters` sends enum strings (`chest`, `barbell`) and plural lists; the backend's `GET /exercises` accepts a single UUID for `muscleGroup`, no `equipment` param, and no `createdBy`. The filter UI looks like it's working but is silently under-filtering (or outright ignored) server-side.
3. **Reference data is hardcoded on the mobile.** Muscle groups / equipment / categories are enum constants in `packages/mobile/src/domain/models/exercise.ts`. The backend has a UUID-keyed reference catalog (`GET /exercises/muscle-groups`, `/equipment`, `/categories`). Without translating between them, nothing aligns.

M0 closes all three gaps. No new screens. No new features. Just make what shipped actually work against `bun run dev`.

This is the first milestone executed under the new parallel-agent model. If we get M0 right, M1–M11 become straightforward.

## Parent spec

[`../../03-exercise-library/`](../../03-exercise-library/) — closes drift from Phase 4 and unblocks Phases 5–8.

See also [`HISTORICAL_PHASE_4_BRIEF.md`](./HISTORICAL_PHASE_4_BRIEF.md) for the context of what shipped.

## Scope summary

### Backend

- `POST /exercises` — create a custom exercise. JWT-auth. Ownership = `sub` from JWT. Sets `isCustom: true`.
- `PATCH /exercises/:id` — owner-only partial update. 403 if not owner. 404 if not found.
- `DELETE /exercises/:id` — owner-only soft delete (prefer) or hard delete.
- Extend `GET /exercises` filter to accept comma-joined multi-value params (`muscleGroup`, `difficulty`, `equipment`) plus a new `createdBy=mine|system` param.

### Frontend

- Add a domain `ReferenceLists` model + port methods on `ApiPort` (`getReferenceLists`) and `StoragePort` (cached list CRUD).
- New SQLite table `reference_lists` (entity_type, entries, synced_at) with 24h staleness.
- New application query `getReferenceListsQuery` (cache-first, background refresh when stale).
- `SSTApiAdapter`: fix `buildExerciseQueryParams` to send server-shaped params; add muscle-group enum → UUID translation via the reference cache; map `equipment` and `createdBy` through; drop `cursor` for `offset`.
- `ExerciseFiltersContainer` + `ExerciseFiltersPresenter`: replace hardcoded `MUSCLE_GROUPS`/`EQUIPMENT_TYPES` iteration with reference-list values.
- Port hierarchical filter modal pattern from legacy (`/app/exercises.tsx` in `persistence-mobile`): section list → detail screen per axis, with search on the long lists.
- Wire `createExerciseCommand`'s sync-queue entry through `mapCreateExerciseInputToApi` so the backend receives the expected wire format.

## Success criteria (review gate)

Done when **all** of these pass against `bun run dev` on a real simulator:

1. Open **Exercises** tab. Backend reference-list endpoints are called once on first launch, cached. Muscle group chips in the filter modal show the real backend catalog (not enum labels).
2. Apply "Chest" + "Barbell" filter → list updates to only show matching exercises. Check server access logs — correct UUIDs were sent.
3. Tap the new `+` button → legacy-style creator form → create an exercise → see it in the "My Exercises" quick filter. Row appears in `exercises` table in Postgres.
4. Tap that exercise → (M5 will handle detail; for M0, edit inline if the creator supports it, otherwise scope to PATCH-only via a dev hook) → verify `PATCH /exercises/:id` succeeds only for the owning user.
5. Delete the exercise → gone from the list, `DELETE /exercises/:id` returns 204, row removed server-side.
6. Go offline → open filter modal → muscle-group list still renders from cache.
7. Go offline → create an exercise → local-cache ID assigned, shows in list with a sync-pending indicator → reconnect → mutation flushes successfully.

Plus the per-PR quality gates (prettier / typecheck / lint / build / test, 90% coverage on changed files).

## Agent briefs

Two parallel agent tracks. Each reads its own brief plus the parent spec and any referenced code files.

- **Backend:** [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md)
- **Frontend:** [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md)
- **Smoke test:** [`SMOKE_TEST.md`](./SMOKE_TEST.md)

Both PRs land on a shared milestone branch `feat/m0-integration-baseline`. Neither merges individually — both pass smoke test, then squash as one.

## Explicit non-goals for M0

- **No new screens.** Detail screen and creator screen are M5. If the creator flow doesn't already exist in Phase 4, the M0 frontend can stub it behind an app-only dev hook (see FRONTEND_BRIEF §5) so the write path is exercised in smoke-testing — but no user-facing create-screen work.
- **No cursor-based pagination on the backend.** Backend continues offset/limit. Mobile adapts.
- **No changes to Phase 4 presenter visual design.** If the hierarchical filter modal port requires lifting muscle/equipment list rendering out, do it minimally — polish is M11.
- **No exercise AI classification.** Deferred to M5.
- **No touching other feature areas.** Workouts, sessions, progress, notifications — not in M0.

## Cross-cutting notes from the spec sweep (carry into the briefs)

- The Exercise domain model uses string enums; the backend uses UUIDs. The reference-list cache is the translation layer; design it to be reusable for goal types, measurement types, etc. in later milestones.
- The sync-queue wire-format drift described in the Phase 4 brief is owned by M0's frontend agent. That fix lives at the boundary of `createExerciseCommand` and the adapter's mapper.
- The `InMemoryApiAdapter` already supports `filterExercises` natively; the adapter tests for the new params should be against the SST-shaped wire contract, not the in-memory one.
