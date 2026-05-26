# M4 — Backend Agent Brief

You are implementing the backend track of Milestone 4 — Progress. Read the parent [`BRIEF.md`](./BRIEF.md) first, then this brief, then the parent spec [`../../06-progress-goals/`](../../06-progress-goals/) end-to-end.

You are working on the SST / Elysia backend at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/microservices/core/`. You are NOT touching the mobile app — that is the frontend agent's responsibility. You may read mobile code (especially `packages/mobile/src/domain/ports/api.port.ts`) for contract context but must not modify it (except for the wire-type updates listed in slice 5, mirroring the M3 backend-PR pattern).

## Authority

- Parent spec: [`../../06-progress-goals/`](../../06-progress-goals/) — requirements + design + tasks. Currently has gaps M4's first commit must close (see § Spec-update commit below).
- Backend architectural rules: [`CLAUDE.md`](../../../CLAUDE.md) at repo root (SST v3 + Elysia + Neon + Drizzle + JWT auth + explicit ownership checks).
- Workflow discipline: [`../../_agent.md`](../../_agent.md) — spec-first, always.
- M3 PR-detection canonical: [`microservices/core/src/application/repositories/personalRecordsRepository.ts`](../../../microservices/core/src/application/repositories/personalRecordsRepository.ts). DO NOT modify. M4 reads.

## TL;DR

Most of the M4 backend surface already exists from M1 (dashboard) + M3 (personal records) + the prior incremental work that wired `progressStatsHandler` / `progressRecordsHandler` / `progressHistoryHandler` / `measurementsCreateHandler` / `measurementsListHandler` / `personalRecordsListHandler` / full `goals` CRUD. M4 adds the small set of endpoints the mobile Progress UI needs that don't yet exist + tightens one weak ownership pattern + commits the spec deltas the parent spec is missing.

The PR is small. Plan for 4–7 commits, ~600–1200 LOC across handlers + repository + tests + spec updates.

## Spec-update commit (FIRST commit on the branch — non-negotiable)

Before any implementation commit, your first commit edits the parent spec to close the seven gaps documented in [`BRIEF.md`](./BRIEF.md) § "Spec alignment + gaps". Specifically:

### Edit `specs/06-progress-goals/design.md`

1. **Record-type ladder alignment (gap 1)** — Lines 33–41 (`RecordType` union): add `'max_volume'`. Add an explicit comment that `'1rm' | '3rm' | '5rm' | '10rm'` require exact rep counts (no Epley); `'max_weight'` and `'max_volume'` always emit when weight + reps are present; `'max_reps' | 'best_time' | 'longest_distance'` are enum-eligible but not computed in V2-shipped code. Cite [`personalRecordsRepository.ts`](../../../microservices/core/src/application/repositories/personalRecordsRepository.ts) as the canonical implementation reference.
2. **New "Progress mobile architecture (M4)" section (gap 2)** — Mirror the "Dashboard mobile architecture (M1)" section's shape. The backend agent ONLY writes the section header + a placeholder bullet pointing to the frontend brief; the frontend agent's spec-update commit fills the actual SQLite shapes + query layer.
3. **Goal status enum reconciliation (gap 3)** — Default to **Option B** (drop `'abandoned'`; `isActive = false` is "completed"). Update lines 65–66 accordingly. If the agent gets explicit direction otherwise from Brad pre-PR, document the alternative and the schema migration plan.
4. **Goal target / current / unit fields (gap 4)** — Default to **defer schema changes**. Update the existing line ~219 follow-up note to say "M4 ships without goal-progress storage; goals render as title + (optional) target date; `GoalProgressBar` is mounted only on goals with non-zero target". Document a future-work entry under § Non-goals for M4.
5. **Time-range presets (gap 5)** — Add a "Time ranges" subsection under the new "Progress mobile architecture (M4)" section header (frontend agent fills the body). Add a backend-side note: `GET /progress/stats?from=&to=` accepts any valid ISO 8601 UTC pair; the mobile picks the preset → date math.
6. **`/progress/history` shape vs strength chart (gap 6)** — Default to **Option B**: add a new endpoint `GET /progress/strength?exerciseId=&from=&to=` returning sets-by-session for the requested exercise within the window. Document under § Endpoints. If Option A is preferred mid-implementation, surface as an inline spec-update commit, do not silently switch paths.
7. **Measurement edit / delete (gap 7)** — Edit `requirements.md` STORY-001 to add:
   - **AC 1.6**: User can edit a logged measurement; PATCH preserves `measuredAt` unless explicitly changed; ownership-checked (404 on wrong user).
   - **AC 1.7**: User can delete a logged measurement; idempotent (404 only when row doesn't exist OR doesn't belong to the caller; never leaks ownership across users).

### Edit `specs/06-progress-goals/tasks.md`

8. **Phase 5 (UI — Measurements)** + **Phase 6 (UI — Goals)** + **Phase 7 (UI — Personal Records)** — append a note that the surfaces depend on M4 backend gap-fills (PATCH/DELETE measurements, `/progress/strength`, optional goal-status field). Don't tick anything yet — that's the implementation commits' job.
9. **New Phase 4c — M4 backend gap-fills**. Trace each new endpoint / handler change to a `requirements.md` AC and a `design.md` section. Use the M0 / M1 / M3 "Phase Xa / Xb" pattern.

Commit message format:

```
docs(M4): backend audit + spec updates for Progress milestone

- design.md: RecordType ladder + new "Progress mobile architecture (M4)" section header + goal-status reconciliation + /progress/strength endpoint
- requirements.md: STORY-001 AC 1.6 + 1.7 (measurement edit/delete)
- tasks.md: Phase 4c — M4 backend gap-fills

Spec alignment: closes gaps 1, 3, 5, 6, 7 from specs/milestones/M4-progress/BRIEF.md § Spec alignment + gaps. Gaps 2 (mobile architecture) + 5 (mobile time-range presets) are owned by the frontend agent's spec-update commit.
```

ONLY after this commit lands do implementation commits start.

## Scope

Five logical slices. Recommended commit order: spec → measurement PATCH → measurement DELETE → `/progress/strength` → goal status. Each slice ships its own tests + 90% branch coverage on changed files. Land all on the same branch.

### 1. `PATCH /measurements/:id` — edit a logged measurement

Spec: [`design.md` § (new — backend agent's spec-update commit writes the section)](../../06-progress-goals/design.md), satisfies AC 1.6.

**Handler**: `microservices/core/src/application/measurements/update/measurementsUpdateHandler.ts` (new)

**Behaviour**:

- Method: `PATCH`
- Path: `/measurements/:id`
- Auth: **required** (JWT via `requireAuth` middleware).
- Body: optional fields matching the create handler — `weightKg`, `bodyFatPercentage`, `chestCm`, `waistCm`, `hipsCm`, `leftArmCm`, `rightArmCm`, `leftThighCm`, `rightThighCm`, `notes`, `measuredAt` (optional — defaults to preserve existing).
- Response: `{ data: BodyMeasurement }` (updated row) on success; 404 on wrong user or missing id; 422 on body-validation failure.

**Repository**: extend `microservices/core/src/application/repositories/measurementRepository.ts` with `update(id: string, userId: string, data: Partial<...>): Promise<BodyMeasurement | null>`.

- **TOCTOU discipline (M2 learning #14)**: fold ownership into the mutation WHERE — do NOT do a SELECT-then-UPDATE. Pattern:

  ```typescript
  const result = await db
    .update(bodyMeasurements)
    .set({ ...data })
    .where(
      and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.userId, userId)),
    )
    .returning();

  return result[0] ?? null;
  ```

  Returns `null` when zero rows updated. Handler maps `null` → 404.

- **Decimal serialisation**: Drizzle stores decimals as strings; coerce numeric body inputs to strings before insert/update (mirror the create handler's `String(...)` pattern at lines 22–40 of `measurementsCreateHandler.ts`).

**Wire shape**:

```typescript
PATCH /measurements/:id
Authorization: Bearer <jwt>
Content-Type: application/json

{
  weightKg?: number | string;
  bodyFatPercentage?: number | string;
  chestCm?: number | string;
  waistCm?: number | string;
  hipsCm?: number | string;
  leftArmCm?: number | string;
  rightArmCm?: number | string;
  leftThighCm?: number | string;
  rightThighCm?: number | string;
  notes?: string;
  measuredAt?: string;  // ISO 8601 UTC; omit to preserve existing
}

Response 200: { "data": BodyMeasurement }
Response 404: { "error": "Measurement not found" }    // wrong user OR missing
Response 422: { "error": "Invalid body" }              // Elysia body validation
```

**Tests** (place in `__tests__/measurementsUpdateHandler.test.ts`):

- Happy path: own measurement, valid body → 200 + updated row
- Decimal coercion: number input → stored as string, returned as string by repository (consistent with existing handler behaviour)
- Wrong user → 404 (TOCTOU regression — verify the fold-into-WHERE pattern survives)
- Missing id → 404
- Empty body → 200 + unchanged row (Elysia tolerates partial updates)
- Auth missing → 401 (covered by middleware)

### 2. `DELETE /measurements/:id` — remove a logged measurement

Spec: same section, satisfies AC 1.7.

**Handler**: `microservices/core/src/application/measurements/delete/measurementsDeleteHandler.ts` (new)

**Behaviour**:

- Method: `DELETE`
- Path: `/measurements/:id`
- Auth: **required**.
- Response: 204 (no content) on success; 404 on wrong user or missing id.

**Repository**: `MeasurementRepository.delete(id, userId): Promise<boolean>` — fold ownership into the WHERE per M2 learning #14:

```typescript
const result = await db
  .delete(bodyMeasurements)
  .where(and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.userId, userId)))
  .returning({ id: bodyMeasurements.id });

return result.length > 0;
```

**Tests**:

- Happy path: own measurement → 204
- Wrong user → 404 (TOCTOU regression)
- Missing id → 404
- Idempotency: DELETE-then-DELETE-again on the same id → first 204, second 404 (no leak about prior existence to wrong-user callers — same 404 either way)
- Auth missing → 401

### 3. `GET /progress/strength?exerciseId=&from=&to=` — per-exercise strength data

Spec: [`design.md` § (new — backend agent's spec-update commit writes this)](../../06-progress-goals/design.md), satisfies STORY-004 AC 4.2 + AC 4.5 (time range).

**Handler**: `microservices/core/src/application/progress/progressStrengthHandler.ts` (new)

**Behaviour**:

- Method: `GET`
- Path: `/progress/strength`
- Auth: **required**.
- Query params:
  - `exerciseId` — required (UUID). Backend filters per-exercise to keep payload bounded.
  - `from` — optional ISO 8601 UTC; defaults to `now - 1 year` if absent. (Frontend always sends; this is a safety default.)
  - `to` — optional ISO 8601 UTC; defaults to `now` if absent.
- Response: `{ data: ProgressStrengthPoint[] }` ordered by `sessionCompletedAt ASC` (chronological for chart). Each point:

  ```typescript
  {
    sessionId: string;
    sessionCompletedAt: string; // ISO 8601 UTC
    bestSet: {
      setId: string;
      weightKg: number;
      reps: number;
      oneRepMax: number | null; // Epley estimate FOR CHART RENDERING ONLY (weight * (1 + reps / 30)); see note below
      maxVolume: number; // weight * reps
    }
    totalVolume: number; // sum across all completed sets for this exercise in this session
  }
  ```

  **Critical**: the `oneRepMax` field in this response IS an Epley estimate — but it is only consumed by the per-exercise STRENGTH CHART (line trend over time), NOT by the PR carousel / achievements screen. Document this discipline in the handler comment + the frontend brief. The PR carousel reads `personal_records` (canonical, exact-rep-match) via the M3-shipped `GET /personal-records` endpoint. The strength chart is a DIFFERENT view; trend smoothing across heterogeneous rep-ranges requires Epley estimation as the only reasonable comparable. Brad's call (confirm pre-merge if any doubt): trend chart Epley OK; achievement card Epley NOT OK.

**Repository**: extend `microservices/core/src/application/repositories/progressRepository.ts` with `getStrengthHistory(userId, exerciseId, from, to): Promise<ProgressStrengthPoint[]>`.

Query shape:

```typescript
// pseudo-Drizzle
SELECT
  workout_sessions.id AS sessionId,
  workout_sessions.completed_at AS sessionCompletedAt,
  exercise_sets.id AS setId,
  exercise_sets.weight_kg AS weightKg,
  exercise_sets.reps AS reps
FROM exercise_sets
INNER JOIN session_exercises ON exercise_sets.session_exercise_id = session_exercises.id
INNER JOIN workout_sessions ON session_exercises.session_id = workout_sessions.id
WHERE workout_sessions.user_id = $userId
  AND session_exercises.exercise_id = $exerciseId
  AND workout_sessions.completed_at BETWEEN $from AND $to
  AND workout_sessions.status = 'completed'
  AND exercise_sets.is_completed = true
  AND exercise_sets.weight_kg IS NOT NULL
  AND exercise_sets.reps IS NOT NULL
ORDER BY workout_sessions.completed_at ASC;
```

Then in application code, group rows by `sessionId`, pick the best set per session (highest `weight * reps`), compute `oneRepMax` (Epley) + `totalVolume`.

**Tests**:

- Happy path: user with three completed sessions for the exercise → returns 3 points ordered chronologically
- Empty (user has no sets for exercise in window) → returns `{ data: [] }` + 200
- Out-of-window sessions excluded
- Cross-user isolation: another user's sets for the same exercise must NOT appear
- Cancelled / in-progress sessions excluded
- Decimal coercion: weightKg as numeric string → returned as number
- Missing exerciseId query param → 400

### 4. Goal status update — extend existing `PATCH /goals/:id`

Spec: [`design.md` § Goals](../../06-progress-goals/design.md), satisfies STORY-003 AC ("Mark goal as completed").

**Approach decision**: rely on the existing `PATCH /goals/:id` handler with a body field `isActive: boolean`. No new endpoint. This is the simpler path given Option B (gap 3) — `isActive: false` is "completed".

**Implementation**:

- Verify the existing [`goalsUpdateHandler.ts`](../../../microservices/core/src/application/goals/update/goalsUpdateHandler.ts) accepts `isActive` in its body validator. If not, add it: `isActive: t.Optional(t.Boolean())`.
- Confirm the existing `GoalRepository.update` uses fold-into-WHERE per M2 learning #14. Read the file — if it does a SELECT-then-UPDATE (per [the snippet at lines 56–65](../../../microservices/core/src/application/repositories/goalRepository.ts)), refactor to single-mutation-with-ownership-WHERE as a side-task in this commit. Add a wrong-user-403 test.
- Add a test: `PATCH /goals/:id { isActive: false }` → 200 + updated row with `isActive: false`. Re-PATCH with `isActive: true` reverts.

**No new file**. Modifies `goalsUpdateHandler.ts` body validator + `goalRepository.ts` ownership pattern.

### 5. Mobile-side wire types (this PR also touches `packages/mobile`)

Following the M3 backend-PR pattern (the backend PR ships mobile-side `ApiPort` declaration changes so the contract is consistent in one merge):

- `packages/mobile/src/domain/ports/api.port.ts`:
  - Add `updateMeasurement(id: string, data: UpdateMeasurementInput): Promise<Result<ApiMeasurement, ApiError>>`.
  - Add `deleteMeasurement(id: string): Promise<Result<void, ApiError>>`.
  - Add `getStrengthHistory(params: GetStrengthHistoryParams): Promise<Result<ApiStrengthPoint[], ApiError>>`.
  - Confirm `updateGoal` signature already accepts `isActive` (it inherits from `Partial<CreateGoalInput>`; verify `CreateGoalInput` includes `isActive` or extend `UpdateGoalInput`).
  - Add the matching type aliases: `ApiMeasurement`, `UpdateMeasurementInput`, `ApiStrengthPoint`, `GetStrengthHistoryParams`. Match the wire shapes documented above.
- `packages/mobile/src/adapters/api/sst-api.adapter.ts`: implement the three new methods. Thin wrappers over `requestEnvelope<T>` — see the existing measurement create + progress stats methods for the reference pattern.
- `packages/mobile/src/adapters/api/__tests__/in-memory-api.adapter.ts`: extend with in-memory implementations of the three new methods + their state mutation. Used by the frontend agent's container tests.
- **No** domain or UI code in this PR — that's the frontend agent's territory.

### Register all new routes in `microservices/core/src/api.ts`

```typescript
.use(measurementsUpdateHandler)
.use(measurementsDeleteHandler)
.use(progressStrengthHandler)
```

Place alphabetically alongside the existing `measurementsCreateHandler` / `measurementsListHandler` / `progressStatsHandler` registrations.

## Existing surface to verify (no changes expected; tests pass)

Before writing any new handler, run the existing `bun --filter @persistence/core test:unit` suite to confirm M3 + M1 + M0 surfaces stay green. Then audit:

- [`progressStatsHandler`](../../../microservices/core/src/application/progress/progressStatsHandler.ts) — confirms shape matches the mobile `ProgressStats` view-model in the frontend brief.
- [`progressHistoryHandler`](../../../microservices/core/src/application/progress/progressHistoryHandler.ts) — confirm pagination semantics (`limit` / `offset` as string query params is the existing shape — keep it).
- [`progressRecordsHandler`](../../../microservices/core/src/application/progress/progressRecordsHandler.ts) — surfaces the full PR list ordered by `achievedAt DESC`. Confirm decimal coercion at the repository layer matches the M1 pattern (numeric string → number).
- [`personalRecordsListHandler`](../../../microservices/core/src/application/personalRecords/list/personalRecordsListHandler.ts) — already shipped in M3. M4's PR carousel + Records list both consume this. Verify response shape: `{ data: PersonalRecord[] }`, filter params (`exerciseId`, `recordType`, `limit`, `offset`).
- [`measurementsListHandler`](../../../microservices/core/src/application/measurements/list/measurementsListHandler.ts) — confirm ordering is `measured_at DESC` (most recent first) + decimal-string-to-number coercion at the repository.
- [`goalsListHandler`](../../../microservices/core/src/application/goals/list/goalsListHandler.ts) — confirm response includes `goal_types` joined fields (title, category, etc.) the way the M1 dashboard does for `activeGoals`. If not, decide between extending the list response or having the mobile fetch goal types separately. Default: extend the list response to include the joined goal_type fields for parity with M1.

If any of the above DOES need a shape change, add a slice 6 ("Existing-handler shape parity"). Likely small. Keep it in this PR rather than splitting.

## Quality gates

```bash
bun run prettier:check    # format
bun run typecheck          # TypeScript strict
bun run lint               # ESLint (zero errors; warnings tolerated if pre-existing)
bun run build              # all packages
bun --filter @persistence/core test:unit   # 90% branches non-negotiable on changed files
```

Total core test count after M4: target +20–35 tests from current baseline (track in your PR description).

## Files you will touch

```
microservices/core/src/api.ts                                            # route registration
microservices/core/src/application/measurements/update/
  measurementsUpdateHandler.ts                                            # new
  __tests__/measurementsUpdateHandler.test.ts                              # new
microservices/core/src/application/measurements/delete/
  measurementsDeleteHandler.ts                                            # new
  __tests__/measurementsDeleteHandler.test.ts                              # new
microservices/core/src/application/progress/
  progressStrengthHandler.ts                                               # new
  __tests__/progressStrengthHandler.test.ts                                # new
microservices/core/src/application/goals/update/
  goalsUpdateHandler.ts                                                   # extend body validator if needed
microservices/core/src/application/repositories/
  measurementRepository.ts                                                # extend with update + delete
  progressRepository.ts                                                   # extend with getStrengthHistory
  goalRepository.ts                                                       # refactor update/delete to fold-into-WHERE
  __tests__/measurementRepository.test.ts                                 # extend
  __tests__/progressRepository.test.ts                                    # extend
  __tests__/goalRepository.test.ts                                        # extend (TOCTOU regression)
packages/mobile/src/domain/ports/api.port.ts                              # extend with three new method signatures + types
packages/mobile/src/adapters/api/sst-api.adapter.ts                       # implement
packages/mobile/src/adapters/api/__tests__/in-memory-api.adapter.ts       # extend with stubs

# Spec edits (first commit)
specs/06-progress-goals/design.md
specs/06-progress-goals/requirements.md
specs/06-progress-goals/tasks.md
specs/milestones/M4-progress/BRIEF.md                                     # append "Backend spec-update complete" status note
```

## Files you will NOT touch

- Anything under `packages/mobile/src/ui/` or `packages/mobile/src/domain/` (beyond `api.port.ts`) — frontend agent's territory.
- Anything under `packages/mobile/app/` — frontend agent's territory.
- [`personalRecordsRepository.ts`](../../../microservices/core/src/application/repositories/personalRecordsRepository.ts) — final from M3. Reads OK; writes are M3's contract.
- The webhook handlers (`microservices/core/src/application/stripe/eventHandlers/*`).
- `packages/db/src/schema.ts` — **no schema changes in M4** unless gap 3 / 4 explicitly require it (default = no).
- `infra/` — no SST resource changes; the existing API stack covers all the new routes.

## TOCTOU discipline reminder (M2 learning #14)

EVERY mutation method (UPDATE / DELETE) MUST fold ownership into the WHERE clause. The existing `GoalRepository.update` and `GoalRepository.delete` ([lines 56–65 + 83–96](../../../microservices/core/src/application/repositories/goalRepository.ts)) do a SELECT-then-mutate. Refactor as part of this PR. New `MeasurementRepository.update` and `MeasurementRepository.delete` must use the correct pattern from day one. Add wrong-user-403 unit tests for all four refactored / new methods.

## Decimal-coercion discipline

Drizzle's `decimal()` columns return strings. The wire format must coerce to `number` at the repository OR the handler — but the choice MUST be consistent.

- **Read endpoints** that the mobile consumes for display (PR cards, measurement list, strength chart points) coerce at the repository so consumers always get numbers.
- **Write endpoints** accept either number or decimal string in the body validator (`t.Union([t.String(), t.Number()])`); coerce input to string before insert/update (Drizzle's expected type for decimal columns).

This mirrors the existing measurement / progress repository patterns. Maintain consistency.

## Inspector Brad expectations

Backend touches in M4 are small. Expect 1–2 sweeps maximum. Patterns Brad has flagged before that apply here:

- **TOCTOU on ownership-checked mutations.** Fold into WHERE; single mutation; single round-trip. Test wrong-user → 404, not 403 (consistent with existing 404 surface).
- **Decimal precision discipline.** PR #62 ate a phantom-PR bug from float vs 2dp-stored mismatch. Measurements / strength chart numbers are also decimal-stored — coerce at the boundary, consistently.
- **Empty-state coverage.** Every new handler test must include the "user has no data" case. Empty arrays, 200 status. Not 404.
- **No raw SQL.** Use Drizzle query builder. The `personalRecordsRepository.recordPRsForSession` uses `sql\`excluded.value\`` for the upsert — that's an exception; new code stays builder-only.

TRACE before patching. State the exact code reading + reproduction sequence in commit messages.

## Planned commit shape (post in PR description before pushing implementation commits)

1. `docs(M4): backend audit + spec updates for Progress milestone` — closes gaps 1, 3, 5, 6, 7 in the parent spec. See § Spec-update commit above for the message body template.
2. `feat(core): PATCH /measurements/:id with TOCTOU-safe update` — new handler + repo method + tests.
3. `feat(core): DELETE /measurements/:id with TOCTOU-safe delete` — new handler + repo method + tests.
4. `feat(core): GET /progress/strength endpoint` — new handler + repo method + tests. Document the Epley-OK-for-trend-chart discipline in the handler header comment.
5. `fix(core): fold goal update/delete ownership into mutation WHERE (M2 learning #14)` — refactor + wrong-user-403 tests.
6. `feat(mobile): extend ApiPort + sst-api adapter for M4 wire types` — declarations + adapter impls + in-memory stubs. No domain or UI code.

6 commits. Each cites the parent spec section it implements (`Implements: specs/06-progress-goals/design.md § …`).

## Smoke (backend slice — full e2e in [SMOKE_TEST.md](./SMOKE_TEST.md))

```bash
# Spin up local SST
bun run dev

# 1. Create a measurement
curl -XPOST $API/measurements -H "Authorization: Bearer $JWT" -d '{"weightKg": 80, "bodyFatPercentage": 18.5}'
# → 201 + measurement

# 2. PATCH the measurement
curl -XPATCH $API/measurements/$MID -H "Authorization: Bearer $JWT" -d '{"bodyFatPercentage": 17.8}'
# → 200 + updated row

# 3. Wrong-user PATCH (different JWT)
curl -XPATCH $API/measurements/$MID -H "Authorization: Bearer $OTHER_JWT" -d '{"bodyFatPercentage": 50}'
# → 404 (TOCTOU regression check)

# 4. DELETE the measurement
curl -XDELETE $API/measurements/$MID -H "Authorization: Bearer $JWT"
# → 204

# 5. GET /progress/strength for an exercise with completed sessions
curl "$API/progress/strength?exerciseId=$EID&from=2026-04-01T00:00:00Z&to=2026-05-25T23:59:59Z" -H "Authorization: Bearer $JWT"
# → 200 + array of strength points, each with bestSet + totalVolume

# 6. PATCH /goals/:id { isActive: false }
curl -XPATCH $API/goals/$GID -H "Authorization: Bearer $JWT" -d '{"isActive": false}'
# → 200 + updated goal

# 7. GET /personal-records (M3-shipped; verify still working post-M4)
curl "$API/personal-records?limit=50" -H "Authorization: Bearer $JWT"
# → 200 + array of PRs with exact-rep-match record types
```

## When you finish

- Tests pass with 90% branch coverage on touched files
- Spec edits live as the first commit on the branch; cite the spec sections in every implementation commit's footer
- `gh pr create` against `main` with the M4 reference and SMOKE_TEST link in the description
- Wait for Brad to fire `@inspector-brad` — do not pre-empt
- After fixes land, surface a `(finding, severity, patch)` summary table so Brad can decide whether to re-fire
