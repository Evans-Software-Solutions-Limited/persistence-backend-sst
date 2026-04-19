# M0 — Backend Agent Brief

You are implementing the backend track of Milestone 0 — Integration Baseline. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the SST / Elysia backend at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/microservices/core/`. You are NOT touching the mobile app — that is the frontend agent's responsibility. You may read mobile code for contract context but must not modify it.

## Authority

- Parent spec: [`../../03-exercise-library/`](../../03-exercise-library/) — requirements and design decisions live here.
- Backend architectural rules: [`CLAUDE.md`](../../../CLAUDE.md) at repo root (SST v3 + Elysia + Neon + Drizzle + JWT auth + explicit ownership checks).
- Workflow discipline: [`../../_agent.md`](../../_agent.md) — spec-first, always.
- If the brief is silent, the parent spec wins. If the parent spec is silent on something the brief describes, that's a spec gap — close it FIRST via a spec update commit, then implement.

## Spec alignment — READ FIRST

The parent spec `specs/03-exercise-library/` does **not currently describe the backend endpoints this milestone ships**. The mobile-side `ApiPort.createExercise` / `updateExercise` / `deleteExercise` methods exist, and `SSTApiAdapter` has mappers for them, but the corresponding Elysia handlers have never been specced.

Your first task on this branch, BEFORE any handler code, is to close that gap. Commits 1–3 of your PR should be:

1. **`docs(03-exercise-library): extend design.md with backend write endpoints`**
   Add a new section to `specs/03-exercise-library/design.md` titled "Backend write endpoints". Include:
   - `POST /exercises` — request shape, response shape, ownership = JWT `sub`, sets `is_custom: true`, status codes
   - `PATCH /exercises/:id` — owner-only (404 on non-owner, not 403), partial update semantics
   - `DELETE /exercises/:id` — owner-only, soft-delete if `deleted_at` exists else hard
   - Extended `GET /exercises` filter shape (multi-value `muscleGroup`, `difficulty`, `equipment`; new `createdBy` enum)
   - Wire format MUST align with what mobile's `SSTApiAdapter.mapCreateExerciseInputToApi` produces — this is the shared contract with the frontend track.

2. **`docs(03-exercise-library): add AC 7.x for backend writes to requirements.md`**
   Append acceptance criteria like:
   - AC 7.3 — a signed-in user can create a custom exercise; the exercise is scoped to their user id and flagged `isCustom: true`
   - AC 7.4 — the creator can edit fields of their own exercise via PATCH
   - AC 7.5 — the creator can delete their own exercise; non-creators receive 404 (not 403) to avoid leaking existence
   - AC 7.6 — list filter accepts multiple muscle group UUIDs, OR-matched within axis, AND-matched across axes
   - AC 7.7 — `createdBy=mine` filter requires authentication and scopes to JWT `sub`; `createdBy=system` requires no auth
     Number ACs consistently with existing `requirements.md` numbering (check the file's scheme first).

3. **`docs(03-exercise-library): mark M0 backend scope in tasks.md`**
   In `tasks.md`, either:
   - Extend the existing Phase 7 list to include the backend handler work with `- [ ]` items, marking them as M0-owned; or
   - Add a new `## Phase 7b: Backend writes (M0)` section
     Each task item should trace to a design section added in commit #1 and an AC from commit #2.

Only AFTER these three commits land on your branch do you start implementing. Every implementation commit must cite the spec section it's implementing in the commit message footer — see [`HANDOVER.md`](./HANDOVER.md) for the template.

If, while writing the spec updates, you find the brief's technical detail disagrees with the parent spec's existing intent, **flag it in the PR description rather than silently picking a side**. The resolution is always "update the spec to reflect the agreed intent", not "code against a brief that contradicts the spec".

## Scope

### 1. Add `POST /exercises`

Creates a user-authored custom exercise. JWT-auth via `requireAuth` middleware. `created_by` = `sub` from the JWT. `is_custom` = `true`.

**Request body shape** (must match what the mobile `CreateExerciseInput` → `mapCreateExerciseInputToApi` produces):

```json
{
  "name": "string, required, 2–100 chars",
  "description": "string | null",
  "instructions": "string | null, max 10000",
  "category": "one of the ExerciseCategory enum",
  "difficultyLevel": "one of the ExerciseDifficulty enum",
  "primaryMuscles": ["MuscleGroup string enum, min 1"],
  "secondaryMuscles": ["MuscleGroup string enum, optional"],
  "equipmentRequired": ["EquipmentType string enum, min 1"]
}
```

**Response**: `{ data: ApiExercise }` with generated `id`, `isCustom: true`, `createdBy: <userId>`.

Status codes: `201` on success, `400` on validation failure, `401` on missing/invalid JWT.

### 2. Add `PATCH /exercises/:id`

Owner-only partial update. Reject (`403`) if `created_by !== sub`. Reject (`404`) if not found. Reject non-owners before leaking existence — return `404` not `403` if the exercise exists but isn't owned (security: don't leak existence of other users' private exercises).

All body fields optional; only sent fields are updated. Same shape as `POST /exercises`.

Response: `{ data: ApiExercise }`. Status: `200`.

### 3. Add `DELETE /exercises/:id`

Owner-only. Same ownership semantics as PATCH. Prefer soft-delete (`deleted_at` column) if the schema supports it; if not, a hard delete is acceptable for M0.

Response: `204 No Content`.

### 4. Extend `GET /exercises` filter shape

Today the handler at `microservices/core/src/application/exercises/list/exercisesListHandler.ts` accepts:

```ts
query: t.Object({
  muscleGroup: t.Optional(t.String({ format: "uuid" })),
  difficulty: t.Optional(t.String()),
  category: t.Optional(t.String()),
  search: t.Optional(t.String()),
  limit: t.Optional(t.Numeric()),
  offset: t.Optional(t.Numeric()),
}),
```

Extend to:

```ts
query: t.Object({
  // Comma-joined UUIDs for multi-select. Single UUID also accepted.
  muscleGroup: t.Optional(t.String()),
  // Comma-joined enum values. "beginner,advanced" etc.
  difficulty: t.Optional(t.String()),
  // Comma-joined UUIDs (or enum values — see below).
  equipment: t.Optional(t.String()),
  category: t.Optional(t.String()),
  // "mine" filters by created_by = sub; "system" by created_by IS NULL or is_custom = false.
  createdBy: t.Optional(t.Union([t.Literal("mine"), t.Literal("system")])),
  search: t.Optional(t.String()),
  limit: t.Optional(t.Numeric()),
  offset: t.Optional(t.Numeric()),
}),
```

**Semantics:**

- Multi-value params OR within axis (`muscleGroup=a,b` → exercises matching a OR b).
- Different axes AND together.
- `createdBy=mine` requires auth — otherwise return 400 ("createdBy=mine requires authentication"). Other filters remain public.

**Repository update**: extend `ExerciseRepository.list()` in `microservices/core/src/application/repositories/exerciseRepository.ts` to accept arrays for `muscleGroup`, `difficulty`, `equipment`, and a `createdBy` filter. Use Drizzle's `inArray` for the OR-match.

### 5. Equipment filter: UUID vs enum

Decide: does `equipment` accept UUIDs (matches backend catalog) or enum strings (matches mobile enums)?

**Recommendation:** accept UUIDs (consistent with `muscleGroup`). The mobile reference-list cache maps enums → UUIDs. If this creates a worse DX elsewhere, flag and propose alternatives; don't unilaterally switch to enums.

### 6. Tests

For each new handler, add tests at `microservices/core/src/application/exercises/<feature>/__tests__/<feature>Handler.test.ts` covering:

- Happy path (create/update/delete/list with each filter)
- Missing auth → 401
- Non-owner → 404 (not 403, per §2)
- Validation failure → 400
- Multi-value filter OR semantics
- `createdBy=mine` without auth → 400
- `createdBy=mine` vs `createdBy=system` partitioning

Follow existing handler test patterns (`workoutsCreateHandler.test.ts` is a good template).

### 7. Files you will touch

- `microservices/core/src/api.ts` — wire new handlers via `.use(...)`
- `microservices/core/src/application/exercises/create/exercisesCreateHandler.ts` — NEW
- `microservices/core/src/application/exercises/update/exercisesUpdateHandler.ts` — NEW
- `microservices/core/src/application/exercises/delete/exercisesDeleteHandler.ts` — NEW
- `microservices/core/src/application/exercises/list/exercisesListHandler.ts` — extend filter schema
- `microservices/core/src/application/repositories/exerciseRepository.ts` — extend `list()` method, add `create()`, `update()`, `delete()`
- `microservices/core/src/application/repositories/exerciseService.ts` — register new repo methods if needed
- Test files alongside each handler (4 test files total: 3 new + 1 extended)

## Files you must NOT touch

- Anything under `packages/mobile/` — frontend agent territory.
- Other backend feature handlers (workouts, sessions, sets, profile, etc.).
- `packages/db/src/schema.ts` unless you need a `deleted_at` column for soft delete (if added, note it in your PR description; it's a migration).

## Quality gates (must pass before PR opens)

- `bun run prettier:check`
- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun run test:unit` — 90% coverage threshold maintained on changed files

## Output expected

- A PR on branch `feat/m0-backend-exercises-writes` (branched from fresh `main`)
- PR title: `feat(core): exercise write handlers + multi-axis filters (M0)`
- PR body ends with a `### How to smoke test` block listing the curl commands (or `bun run` scripts) to exercise each new endpoint locally
- Mark relevant tasks in `specs/03-exercise-library/tasks.md` Phase 7 as done (the offline/sync items that depend on these handlers existing)

## Blocking questions (answer before shipping)

1. **Soft delete vs hard delete for `DELETE /exercises/:id`** — is there an existing `deleted_at` pattern elsewhere? Check `workoutsDeleteHandler.ts`. Follow that convention.
2. **Schema migration** — if soft-delete needs a column, propose the migration in the PR body; do not ship the schema change silently.
3. **Audit trail** — should exercise updates/deletes be logged (for trainer-assigned exercises, history matters)? Check existing patterns. If no existing audit infrastructure, defer to later milestone — note in PR.

## Non-goals

- No cursor-based pagination (mobile adapts to offset/limit).
- No AI classification endpoint — that's M5.
- No reference-list endpoints changed — `muscle-groups`, `equipment`, `categories` already exist and ship as-is.
- No response-shape changes to existing `GET /exercises`, `GET /exercises/:id` unless strictly required for the new filter params.
- No changes to authentication middleware — `requireAuth` as-is.

## Success criteria

Your PR is mergeable when:

1. All 4 handler files exist with tests.
2. All listed quality gates pass.
3. `curl` examples in the PR body successfully create, update, delete, and multi-axis-filter against `bun run dev`.
4. The frontend agent can open an integration PR against your branch and have their smoke test pass.
