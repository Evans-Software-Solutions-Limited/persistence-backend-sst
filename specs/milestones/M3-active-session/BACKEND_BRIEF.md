# M3 — Active Session — BACKEND BRIEF

You are the backend agent for **M3 Active Session**. Read [`BRIEF.md`](./BRIEF.md) and the parent spec [`specs/05-active-session/`](../../05-active-session/) before starting. This brief is the contract for the backend PR; the frontend agent works from [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) in parallel and rebases onto your changes once they merge.

## TL;DR

Session lifecycle handlers exist (`POST/GET/PATCH/DELETE /sessions`, nested `/exercises`, nested `/sets`) and tests pass — the prior milestone wired them in. **However**, the wire format and DB schema are missing fields the M3 domain model requires, and a few helper endpoints don't exist. Ship a single additive backend PR that closes the gap so the mobile contract is binding from day one.

The PR-detection question (`tasks.md` Phase 6) has been resolved: **hybrid — server canonical, client predictive for offline UX** (see § PR-detection decision below).

## Audit status note (paste into PR description)

> Backend session handlers exist end-to-end (POST/GET/PATCH/DELETE on sessions + nested exercises + nested sets, all with JWT-scoped repository methods at `microservices/core/src/application/repositories/sessionRepository.ts`). Mobile `ApiPort` declarations and SST adapter implementations are wired for the seven session methods. **Gap to close before mobile builds against this contract:** (1) DB schema is missing `is_completed` / `completed_at` on `exercise_sets`, `superset_group` / `is_substituted` / `original_exercise_id` on `session_exercises`, and `updated_at` on `workout_sessions` — all required by `specs/05-active-session/design.md` § Domain Model. (2) `GET /sessions` has no `status` filter — required for app-launch resume detection (Story-008). (3) No `GET /personal-records` endpoint — required for quick-fill suggestions (Story-002 AC) and PR detection. (4) `setsUpdateHandler` / `setsDeleteHandler` repo paths do a SELECT-then-mutate instead of folding ownership into the mutation WHERE — regresses M2 learning #14 (TOCTOU). PR plan below ships these as additive changes; no breaking field renames.

## PR-detection decision

**Hybrid, leaning server-authoritative:**

- **Server is canonical.** When a session PATCH transitions `status: in_progress → completed`, the handler iterates the session's sets, compares each against the `personal_records` table for that `(userId, exerciseId, recordType)` and writes new PR rows via `INSERT … ON CONFLICT (user_id, exercise_id, record_type) DO UPDATE WHERE excluded.value > personal_records.value`. The unique index at `schema.ts:456` (`personal_records_user_exercise_type_idx`) guarantees idempotency on replay.
- **Client is predictive.** Mobile keeps an opportunistically-cached `personalRecords` table (synced via `GET /personal-records`) and uses it to (a) populate quick-fill suggestions during set logging, (b) compute the _Summary Screen's_ PR list immediately on session complete — even when offline. When the queued `PATCH /sessions/:id { status: 'completed' }` flushes, the server's authoritative PR list reconciles into the local cache via the home tab's existing `invalidateDashboard` → next focus refresh.
- **Why hybrid, not client-only:** the `personal_records` table is referenced by M4 (PR carousel), M8 (trainer dashboards), and any future analytics surface. A single canonical writer keeps that simple.
- **Why hybrid, not server-only:** offline session completion must show a full summary screen _now_, not after reconnect. M3 is the most offline-critical surface in the app — see `BRIEF.md` § "What you're inheriting" and `design.md` § Offline Resilience.
- **Two record types in scope for M3:** `one_rep_max` (peak weight × reps for an exercise) and `volume` (highest single-set weight × reps). Other record types (`endurance`, `pace`, etc.) defer to M4. The enum in `schema.ts` already supports the broader set; the M3 handler just doesn't write them.

`tasks.md` Phase 6 should be edited to reflect this decision as part of the spec-update commit (see § Planned commit shape below).

## In scope (what the backend PR ships)

### 1. Schema migration — additive only

Add to `packages/db/src/schema.ts` and a new SQL migration in `supabase/migrations/` (Supabase-CLI layout adopted by [`supabase/README.md`](../../../supabase/README.md); applied to staging + production by the `Migrate database` step in `deploy-staging.yml` / `production-deploy.yml`):

| Table               | Column                 | Type                                               | Default  | Notes                                                                                                            |
| ------------------- | ---------------------- | -------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `workout_sessions`  | `updated_at`           | `timestamp with timezone`                          | `NOW()`  | Already documented as required in `microservices/core/src/application/sessions/CLAUDE.md` § "Status Transitions" |
| `session_exercises` | `superset_group`       | `integer`                                          | nullable | Groups exercises for superset cycling UI                                                                         |
| `session_exercises` | `is_substituted`       | `boolean NOT NULL`                                 | `false`  | Flags exercises swapped mid-session                                                                              |
| `session_exercises` | `original_exercise_id` | `uuid REFERENCES exercises(id) ON DELETE SET NULL` | nullable | Original exercise before substitution                                                                            |
| `exercise_sets`     | `is_completed`         | `boolean NOT NULL`                                 | `false`  | Set marked done by user                                                                                          |
| `exercise_sets`     | `completed_at`         | `timestamp with timezone`                          | nullable | Set when `is_completed` flips true                                                                               |

**Naming note:** keep `sort_order` on `session_exercises` (not renaming to `order_index`). The existing M0/M2 wire format already uses `sortOrder` on workouts/exercises; renaming on sessions only would be churn. The spec's `design.md` will be edited to reflect this in the spec-update commit.

Migration must be idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE … IF NOT EXISTS`) per [`supabase/README.md`](../../../supabase/README.md) § "Authoring rules". Rollbacks happen via forward migrations, never by editing or deleting an applied file.

### 2. Handler updates

| Handler                                                | Change                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sessionsCreateHandler`                                | No body change. Repository sets `updatedAt: new Date()` on insert (or DB default handles it).                                                                                                                                        |
| `sessionsUpdateHandler`                                | Repository writes `updatedAt: new Date()` on every mutation. **PR-detection hook**: when `data.status === "completed"` and previous status was `in_progress`, run server-side PR detection (see § 3) inside the same DB transaction. |
| `sessionsListHandler`                                  | Add `status?: SessionStatus` query param (Elysia `t.Optional(t.Union([t.Literal("in_progress"), t.Literal("completed"), t.Literal("cancelled")]))`). Repository: `where(and(eq(userId), status ? eq(status) : undefined))`.          |
| `sessionExercisesCreateHandler`                        | Body accepts: `supersetGroup?: number`, `isSubstituted?: boolean`, `originalExerciseId?: string`. Repository persists them.                                                                                                          |
| `sessionExercisesGetHandler`                           | Response includes the three new fields.                                                                                                                                                                                              |
| `sessionsGetHandler` (via `SessionRepository.getById`) | Explicit column select at `sessionRepository.ts:56-64` extends to include `supersetGroup`, `isSubstituted`, `originalExerciseId`.                                                                                                    |
| `setsCreateHandler`                                    | Body accepts: `isCompleted?: boolean`, `completedAt?: string`. Default `isCompleted: false`.                                                                                                                                         |
| `setsUpdateHandler`                                    | Body accepts: `isCompleted?: boolean`, `completedAt?: string`. Repository: **fold ownership into mutation WHERE** (see § 4).                                                                                                         |
| `setsDeleteHandler`                                    | Repository: **fold ownership into mutation WHERE** (see § 4).                                                                                                                                                                        |
| `setsGetHandler`                                       | Response includes the two new fields.                                                                                                                                                                                                |

### 3. New endpoints

#### `GET /personal-records`

```ts
// query params
{
  exerciseId?: string;       // filter to one exercise
  recordType?: RecordType;   // optional filter
  limit?: number;            // default 50
}
// response
{
  data: PersonalRecord[]
}
```

Place at `microservices/core/src/application/personalRecords/list/personalRecordsListHandler.ts`. New repository at `microservices/core/src/application/repositories/personalRecordsRepository.ts` with two methods: `list(userId, filters)` and `recordPRsForSession(userId, sessionId, tx)` (called by `sessionsUpdateHandler`).

#### Server-side PR-detection logic (called from `sessionsUpdateHandler`)

When the PATCH transitions `status` to `completed`:

1. Load all sets for the session (join `exercise_sets` ⨝ `session_exercises`).
2. For each `(exerciseId, set)`, compute candidate values:
   - `one_rep_max` candidate: `weightKg * (1 + reps / 30)` (Epley) — comparable across rep ranges, the universally-quoted formula. Document the choice in a code comment.
   - `volume` candidate: `weightKg * reps` for that single set.
3. Upsert into `personal_records` keyed by `(userId, exerciseId, recordType)`:
   - `INSERT ... VALUES (..., setId, NOW())`
   - `ON CONFLICT (user_id, exercise_id, record_type) DO UPDATE SET value = EXCLUDED.value, set_id = EXCLUDED.set_id, achieved_at = NOW() WHERE personal_records.value < EXCLUDED.value`
4. For sets that won, set `exercise_sets.is_personal_record = true`.

All in the same transaction as the session-status update so a partial failure rolls everything back. Idempotent on replay because the conflict clause only updates strictly-greater values.

### 4. TOCTOU fix on set mutations

Currently `sessionRepository.updateSet` (lines 264–313) and `deleteSet` (lines 316–361) do three sequential SELECTs to verify ownership, then issue a mutation that doesn't re-check `userId`. M2 learning #14: fold the ownership check into the mutation WHERE.

Refactor both methods to a single mutation using a correlated subquery:

```ts
// updateSet
return db
  .update(exerciseSets)
  .set(data)
  .where(
    and(
      eq(exerciseSets.id, setId),
      inArray(
        exerciseSets.sessionExerciseId,
        db
          .select({ id: sessionExercises.id })
          .from(sessionExercises)
          .innerJoin(
            workoutSessions,
            eq(sessionExercises.sessionId, workoutSessions.id),
          )
          .where(eq(workoutSessions.userId, userId)),
      ),
    ),
  )
  .returning();
```

Returns `null` if zero rows updated (same surface as today). Apply the same pattern to `deleteSet`. Add a unit test for the wrong-user-403 path on both.

### 5. Mobile-side wire types (this PR also touches `packages/mobile`)

Although the backend PR is a backend-first change, it's the right place to ship the mobile-side type updates so the contract is consistent in one merge:

- `packages/mobile/src/domain/ports/api.port.ts`:
  - Add type `ApiSessionExercise` with: `id`, `sessionId`, `exerciseId`, `sortOrder`, `supersetGroup: number | null`, `isSubstituted: boolean`, `originalExerciseId: string | null`, `notes: string | null`, `createdAt: string`.
  - Extend `ApiSession` with `exercises: ApiSessionExercise[]` (the `getById` handler returns the nested array).
  - Extend `ApiExerciseSet` with `isCompleted: boolean`, `completedAt: string | null`.
  - Extend `CreateSetInput` and add `UpdateSetInput` to allow `isCompleted?`, `completedAt?`.
  - Add `getActiveSession(): Promise<Result<ApiSession | null, ApiError>>` — wraps `GET /sessions?status=in_progress&limit=1`, returns the first hit or `null`.
  - Add `createSessionExercise(sessionId, data: CreateSessionExerciseInput): Promise<Result<ApiSessionExercise, ApiError>>` and `deleteSet(sessionId, exerciseId, setId)` (already declared, verify wired).
  - Add `getPersonalRecords(filters?: { exerciseId?: string; recordType?: RecordType }): Promise<Result<ApiPersonalRecord[], ApiError>>`.
- `packages/mobile/src/adapters/api/sst-api.adapter.ts`: implement the new methods. They're thin envelope wrappers over `requestEnvelope<T>` — see the workouts adapter for the reference pattern (M2 learning).

### 6. Spec updates (first commit on the branch)

The first implementation-adjacent commit must edit:

- `specs/05-active-session/design.md` § Domain Model:
  - Field rename: `orderIndex` → `sortOrder` on `SessionExercise` (matches existing wire format on workouts).
  - Add a one-paragraph note under § Offline Resilience explaining the hybrid PR-detection split.
- `specs/05-active-session/tasks.md` Phase 6:
  - Tick "Decide PR-detection placement" with a link back to this brief.
  - Add a sub-bullet for the server-side PR-detection logic in `sessionsUpdateHandler`.
- `specs/milestones/M3-active-session/BRIEF.md`:
  - Append a "Backend audit complete (2026-05-02)" line under § Branch + workflow noting the gap-fill PR shape.

This first commit lands the spec changes only — implementation commits cite spec sections after.

## 7. Bulk-record session endpoint (post-bugbot pivot — Option A)

**Decided 2026-05-04** after discussion with the report owner. The piecemeal CRUD pattern (`POST /sessions` → many `POST /sessions/:id/exercises` → many `POST /sessions/:id/.../sets` → `PATCH /sessions/:id { status: completed }`) is **replaced for the active-session flush path** by a single bulk endpoint that mirrors the legacy `persistence-mobile` repo's `recordWorkout` mutation.

### Why pivoting

- **Legacy app proved the model.** `lib/supabase/queries/workoutMutations.ts:recordWorkout` is the bulk mutation the legacy mobile app called on Finish. It worked for real users at production scale.
- **Atomic.** Session row + exercises + sets + PR detection all run in one Postgres transaction. No partial-flush states; either the whole session lands or none of it does.
- **Mid-session reordering / supersetting come for free.** Active session lives in mobile local state (SQLite + React); reordering / supersetting / substitution mutate that local state; the final shape lands in the bulk POST. **No `PATCH /sessions/:id/exercises/:eid` endpoint needed** for in-flight session mutations.
- **Sync queue is one-intent-per-session.** Mobile flushes a single `recordSession` entry instead of chaining four intents in dependency order with ID swapping.
- **Server-load reduction.** N+M+2 round-trips per session → 1.

### Endpoint contract

```
POST /sessions/record
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "workoutId": "uuid | null",
  "name": "string | null",
  "startedAt": "ISO-8601 string",
  "completedAt": "ISO-8601 string | null",
  "status": "completed | cancelled",
  "totalDurationSeconds": number | null,
  "userNotes": "string | null",
  "sessionRating": number | null,
  "overallRpe": number | null,
  "difficultyRanking": number | null,
  "exercises": [
    {
      "exerciseId": "uuid",
      "sortOrder": number,
      "supersetGroup": number | null,
      "isSubstituted": boolean,
      "originalExerciseId": "uuid | null",
      "notes": "string | null",
      "sets": [
        {
          "setNumber": number,
          "reps": number | null,
          "weightKg": "decimal string | number | null",
          "durationSeconds": number | null,
          "distanceMeters": "decimal string | number | null",
          "rpe": number | null,
          "restAfterSeconds": number | null,
          "isCompleted": boolean,
          "completedAt": "ISO-8601 string | null"
        }
      ]
    }
  ]
}

Response 201:
{
  "data": {
    "id": "<server uuid>",
    "userId": "<derived from jwt>",
    ...all the row fields...,
    "exercises": [
      {
        "id": "<server uuid>",
        "sets": [{ "id": "<server uuid>", ... }, ...],
        ...
      }
    ]
  }
}
```

### Implementation

- New module: `microservices/core/src/application/sessions/record/sessionsRecordHandler.ts`
- New repository method: `SessionRepository.recordSession(userId, payload)` — runs everything in `db.transaction(async (tx) => { ... })`:
  1. Insert into `workout_sessions` (with `userId` from JWT, never the body)
  2. For each exercise: insert into `session_exercises` (with the parent's server id)
  3. For each set: insert into `exercise_sets` (with the parent's server id)
  4. If `status === 'completed'`: call `personalRecordsRepository.recordPRsForSession(userId, sessionId, tx)` — note the `tx` param; the existing method gets a tx-aware overload so it can run inside the bulk transaction.
  5. Re-fetch the full session with nested exercises + sets and return it.
- All ownership checks fold into the JWT-scoped `userId` — no cross-user inserts possible because `userId` is derived from the auth token, not the body.
- Validation: server rejects payloads with empty `exercises` (legacy required at least one), invalid timestamps, completed-before-started, etc. Mirrors `recordWorkout`'s validation block.

### Existing piecemeal endpoints stay

- `POST /sessions/:id/exercises` and `POST /sessions/:id/exercises/:eid/sets` and the corresponding PATCHes / DELETEs **remain** for editing completed sessions (M4 progress edits, trainer review notes in M8).
- The piecemeal handlers still pass through `updatedAt: new Date()` on every mutation per CLAUDE.md.
- The previous `sessionsUpdateHandler` post-hoc PR-detection trigger (commit 5 in PR #46) is retained for the case where someone PATCHes a status to `completed` via the piecemeal path. The bulk endpoint short-circuits this — its in-tx PR detection runs first and idempotently.

### What this means for the M3 frontend brief

[`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) §§ "Sync cadence" + "Group B: commands" updated. The mobile sync queue gets a single `recordSession` intent kind. `createSessionExercise` and `createSet` are no longer called from the active-session flush path; they remain on the `ApiPort` for the editing-completed-session use case.

## Out of scope (don't pull in)

- M4's PR carousel UI. This PR ships the **endpoint** and the **server-side write**, nothing more.
- Renaming `sortOrder` → `orderIndex` on the wire (kept consistent with M2 workouts).
- New record types beyond `one_rep_max` and `volume` (the enum allows them; the writer just doesn't emit them yet).
- Trainer feedback fields (`trainer_feedback`, `session_rating`, `overall_rpe`) — already in schema, nothing to do.
- Subscription gating on session count — M10.

## Planned commit shape (post in PR description before pushing impl commits)

1. `docs(M3): backend audit + brief + spec updates for active-session lifecycle`
   — Authors `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`; edits `design.md` (sortOrder, hybrid PR note) + `tasks.md` Phase 6; expands `BRIEF.md` with the audit conclusion.
2. `feat(db): add session-lifecycle columns + workout_sessions.updated_at`
   — Schema (`packages/db/src/schema.ts`) + idempotent migration. Drizzle types regenerate. _Initial commit landed the migration under `packages/db/migrations/`; relocated in commit 2.5._
   2.5. `feat(ci): adopt Supabase CLI migration layout + wire CI/CD`
   — Mirror legacy `supabase/migrations/` (18 historical files + the M3 file timestamped forward); add `supabase/config.toml`, `supabase/README.md`. Wire `supabase db push --linked` as a pre-deploy step in `deploy-staging.yml` and `production-deploy.yml` — migrations land before the SST code that depends on them. Required GitHub secrets documented in `supabase/README.md` § "Required GitHub secrets".
3. `feat(core): wire isCompleted / supersetGroup / substitution on session handlers`
   — Handler body schemas + repository column lists + tests for new fields. `updated_at` refreshed on every mutation.
4. `feat(core): GET /sessions?status=… + GET /personal-records`
   — New list-filter param + new endpoint + repository + handler tests.
5. `feat(core): server-side PR detection on session complete`
   — `sessionsUpdateHandler` calls `personalRecordsRepository.recordPRsForSession` inside the same tx; flips `is_personal_record` on winning sets.
6. `fix(core): fold set-ownership into mutation WHERE (M2 learning #14)`
   — `updateSet` and `deleteSet` refactor + wrong-user-403 unit tests.
7. `feat(mobile): extend ApiPort + sst-api adapter for M3 wire format`
   — `ApiSessionExercise`, `ApiSession.exercises`, `ApiExerciseSet.isCompleted`, `getActiveSession`, `createSessionExercise`, `getPersonalRecords`. No domain or UI code yet — that's the frontend PR.

8 commits (the 7 originally planned + 2.5 for migration tooling that landed mid-PR after audit-time gap was caught). If commit 5 sprawls (PR detection + transactionality), split into 5a (PR detection helper + tests) and 5b (handler integration).

## Quality gates

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun run test:unit  # 90% aggregate; new repo paths must hit branches
```

Per `BRIEF.md` § M2 learnings #13: `afterEach(jest.restoreAllMocks)`, `mock`-prefixed factory captures, no re-export-only files for new code, 30s explicit timeouts on tests with cascading awaits.

## Smoke (backend slice — full e2e in [SMOKE_TEST.md](./SMOKE_TEST.md))

```bash
# 1. Spin up local SST against staging DB
bun run dev

# 2. Create a session, add an exercise + a winning set, complete it
curl -XPOST $API/sessions -H "Authorization: Bearer $JWT" -d '{"name":"smoke"}'
curl -XPOST $API/sessions/$SID/exercises -H "Authorization: Bearer $JWT" -d '{"exerciseId":"$EID","sortOrder":1,"supersetGroup":null}'
curl -XPOST $API/sessions/$SID/exercises/$SEID/sets -H "Authorization: Bearer $JWT" -d '{"setNumber":1,"weightKg":120,"reps":5,"isCompleted":true}'
curl -XPATCH $API/sessions/$SID -H "Authorization: Bearer $JWT" -d '{"status":"completed","completedAt":"..."}'

# 3. Verify
curl $API/personal-records?exerciseId=$EID -H "Authorization: Bearer $JWT"
# expect: one_rep_max & volume entries with set_id == $SETID, value == 120 * (1+5/30) and 120*5

# 4. Active-session resume probe (should be empty after completion)
curl "$API/sessions?status=in_progress" -H "Authorization: Bearer $JWT"
# expect: { data: [] }
```

## Coordinate

If implementation reveals the wire shape needs further changes (e.g. nested set arrays on `ApiSessionExercise`), raise it on this PR before the frontend rebases. The frontend agent shouldn't translate field shapes silently on the client — bridge it on this PR.
