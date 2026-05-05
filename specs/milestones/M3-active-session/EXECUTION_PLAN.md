# M3 Active Session — Frontend EXECUTION_PLAN

**Audience:** the agent (or developer) picking up the M3 mobile work.
**Status:** planning artifact only — no code yet. Read alongside [`BRIEF.md`](./BRIEF.md), [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md), [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md), [`SMOKE_TEST.md`](./SMOKE_TEST.md), and the parent spec [`05-active-session/`](../../05-active-session/).
**Audit date:** 2026-05-05 (post PR #53).

This file exists because the BRIEFs describe the **target state**, not the **state of the codebase right now**. Without the audit-vs-target mapping, the executing agent's first hour is rediscovering what exists, what's stubbed, and which decisions were already made. This plan flattens that work — read it, then execute against the commit shape in § 2.

---

## 1. State of the world (what's already on `main`)

### Backend — DONE

All M3 backend work shipped via #46 (`feat(core): M3 active-session handlers + endpoints + PR detection`) and #48 (`feat(M3): bulk-record session pivot — POST /sessions/record`).

| Endpoint                                        | Status               |
| ----------------------------------------------- | -------------------- |
| `POST /sessions/record` (bulk flush — primary)  | ✅ #48               |
| `PATCH /sessions/:id` (status transitions + PR) | ✅ #46               |
| `POST/PATCH/DELETE /sessions/:id/exercises/...` | ✅ existing          |
| `POST/PATCH/DELETE .../sets/:setId`             | ✅ #46 (TOCTOU-safe) |
| `GET /sessions?status=in_progress`              | ✅ #46               |
| `GET /personal-records`                         | ✅ #46               |

Server-side PR detection runs inside the bulk-record transaction (DEMOTE + PROMOTE flag re-sync via Epley 1RM). Hybrid model — see [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) § PR-detection decision.

### Mobile foundation — DONE

| Surface                                                                                                                                  | Status |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Sync queue worker (`useSyncWorker`, `processSyncQueue`)                                                                                  | ✅ M2  |
| `enqueueMutation` / `markMutationInFlight` / `pruneCompletedMutations` on `StoragePort`                                                  | ✅ M2  |
| `ApiPort` declares the four M3 methods                                                                                                   | ✅ #48 |
| `sst-api.adapter.ts` implements `recordSession` / `getActiveSession` / `createSessionExercise` / `getPersonalRecords`                    | ✅ #48 |
| In-memory test adapter implements + tests the four M3 methods                                                                            | ✅ #53 |
| `RecordSessionInput`, `RecordedApiSession`, `ApiSessionExercise`, `ApiPersonalRecord`, `GetPersonalRecordsParams` types in `api.port.ts` | ✅ #48 |

### Mobile gaps — TO BUILD (this is the milestone)

| Surface                                                                                             | Status                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `domain/models/session.ts`                                                                          | ❌ does not exist                                                                                                |
| `domain/services/sessionService.ts`                                                                 | ❌ does not exist                                                                                                |
| SQLite session tables (`active_sessions`, `session_exercises`, `exercise_sets`, `personal_records`) | ❌ only a placeholder `active_session` single-blob table exists at `sqlite.adapter.ts:99-106` — must be replaced |
| `StoragePort` extensions (8 methods)                                                                | ❌ none exist                                                                                                    |
| In-memory storage mirror of those 8 methods                                                         | ❌ none exist                                                                                                    |
| Session commands (8 of them)                                                                        | ❌ none exist                                                                                                    |
| `useRestTimer` hook + `RestTimerDisplay`                                                            | ❌ none exist                                                                                                    |
| 5 presentational components (Group D)                                                               | ❌ none exist                                                                                                    |
| `ActiveSessionPresenter` + `ActiveSessionContainer`                                                 | ❌ none exist                                                                                                    |
| `app/(app)/session/index.tsx` + `summary.tsx` routes                                                | ❌ none exist                                                                                                    |
| Quick Start entry point                                                                             | ❌ none exist                                                                                                    |
| App-launch resume detection (`useResumeSession`)                                                    | ❌ none exist                                                                                                    |
| Wire 4 `/coming-soon` callers to `/session?workoutId=…`                                             | ❌ all four still route to `/coming-soon`                                                                        |
| `expo-notifications` dependency                                                                     | ❌ not in `package.json` — added in commit 5                                                                     |

### Existing placeholder to replace

`packages/mobile/src/adapters/storage/sqlite.adapter.ts:99-106` declares:

```sql
CREATE TABLE IF NOT EXISTS active_session (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'local' CHECK(status IN ('local', 'synced', 'pending_sync')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

This is a single-blob shape that does not match the normalized 3-table layout the FRONTEND_BRIEF requires. **Replace** in commit 2 — drop the `active_session` table and create the four M3 tables in its place. There's no production data to migrate (mobile is pre-launch).

`sqlite.adapter.ts:510` also has a `DELETE FROM active_session;` line in `clearAll()` — update to delete from all four new tables (or drop the explicit list and rely on cascading deletes after replacing the schema).

### Legacy components available for 1:1 port

Per project memory ("Port then revamp"), port these into the V2 Container/Presenter shape; `/frontend-design` polish pass after, not during.

| Legacy file                                                           | LOC  | Maps to                                                                                                               |
| --------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `persistence-mobile/components/workouts/ActiveWorkoutScreen.tsx`      | 452  | `ActiveSessionPresenter` + container                                                                                  |
| `persistence-mobile/components/workouts/ActiveWorkoutScreen.test.tsx` | 363  | reference for test scenarios                                                                                          |
| `persistence-mobile/components/workouts/ActiveExerciseRow.tsx`        | 268  | `SessionExerciseCard`                                                                                                 |
| `persistence-mobile/components/workouts/ActiveSetRow.tsx`             | 179  | `SetLogger`                                                                                                           |
| `persistence-mobile/components/workouts/RestTimerScreen.tsx`          | 84   | `RestTimerDisplay`                                                                                                    |
| `persistence-mobile/components/workouts/WorkoutSummaryScreen.tsx`     | 235  | `SessionSummaryPresenter`                                                                                             |
| `persistence-mobile/hooks/useActiveWorkout.tsx`                       | 1211 | reference for the bulk-record payload shape — **already informed PR #48**, do not port wholesale; commands replace it |

`ActiveWorkoutModal` and `ActiveWorkoutBanner` exist in legacy but were a side-flow (banner + modal pair); FRONTEND_BRIEF doesn't reproduce them. Punt unless a real use case surfaces.

---

## 2. Commit shape (refined, with file paths)

The FRONTEND_BRIEF's 10-commit plan stands. The refinement below adds:

- **Concrete file paths** so the agent doesn't guess.
- **Dependencies** between commits so they can't be reordered without thinking.
- **Test seams** so each commit ships with verifiable behaviour.

Each commit cites the parent-spec section it implements (Story-NNN, Phase N).

### Commit 1 — `feat(mobile): session domain models + pure services`

**Phase 1, Stories 001-009 (data model only).**

Creates:

- `packages/mobile/src/domain/models/session.ts` — `WorkoutSession`, `SessionExercise`, `ExerciseSet`, `PersonalRecord`, `SessionSummary`, `SessionStatus`. Match the shapes in [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) § Domain models verbatim. Re-export from `domain/models/index.ts`.
- `packages/mobile/src/domain/services/sessionService.ts` — `createSessionFromWorkout`, `createEmptySession`, `addSetToExercise`, `completeSet`, `substituteExercise`, `addExerciseToSession`, `calculateSummary`, `calculateVolume`, `detectPersonalRecords`. Re-export from `domain/services/index.ts`.
- `packages/mobile/src/domain/services/__tests__/sessionService.test.ts` — 100% coverage. Pure functions, trivial.

**Dependencies:** none. This is the foundation; subsequent commits import from here.

**Verification:** `bun --filter @persistence/mobile test sessionService` — coverage 100% on the service module. Uses an `idFactory: () => string` parameter to keep tests deterministic (M2 learning #7).

### Commit 2 — `feat(mobile): SQLite tables + StoragePort extensions`

**Phase 2, Stories 001/008.**

Modifies:

- `packages/mobile/src/adapters/storage/sqlite.adapter.ts` — replace the placeholder `active_session` table with the four normalized tables from FRONTEND_BRIEF § SQLite tables. Update `clearAll()` to delete from all four. Implement the eight new `StoragePort` methods.
- `packages/mobile/src/domain/ports/storage.port.ts` — add the eight method signatures.
- `packages/mobile/src/adapters/storage/__tests__/in-memory-storage.adapter.ts` — mirror the eight methods on the in-memory test double.
- `packages/mobile/src/adapters/storage/__tests__/sqlite.adapter.test.ts` — extend with active-session round-trip tests (cache → get → clear, plus `personalRecords` cache + filter).

**New StoragePort methods:**

1. `getActiveSession(userId): Promise<WorkoutSession | null>` — joins all three tables.
2. `cacheActiveSession(userId, session): Promise<void>` — upsert root + nested rows.
3. `clearActiveSession(userId): Promise<void>` — delete with cascade.
4. `getSessionSets(userId, sessionId, exerciseId): Promise<ExerciseSet[]>` — quick-fill suggestions.
5. `cachePersonalRecords(userId, records): Promise<void>` — upsert by unique `(user, exercise, type)`.
6. `getPersonalRecords(userId, exerciseId?): Promise<PersonalRecord[]>` — Summary detector + quick-fill.
7. `swapLocalSessionId(localId, serverId): Promise<void>` — rewrites `local-…` ids on the four tables post-flush.
8. _(invalidateDashboard already exists; no change.)_

**Dependencies:** commit 1 (imports `WorkoutSession`, `SessionExercise`, etc.).

**Verification:** in-memory test adapter parity with SQLite adapter (every method has the same input/output behaviour); coverage holds at 90% global.

### Commit 3 — `feat(mobile): session commands (start, log, complete-set)`

**Phase 3 first slice. Stories 001-002.**

Creates:

- `packages/mobile/src/application/commands/session/start-session.command.ts`
- `packages/mobile/src/application/commands/session/log-set.command.ts`
- `packages/mobile/src/application/commands/session/complete-set.command.ts`
- Tests for each at `__tests__/start-session.command.test.ts`, etc.

**Behaviour:**

- `StartSessionCommand` — calls `sessionService.createSessionFromWorkout` (or `createEmptySession`), `storage.cacheActiveSession`, returns the new session. Idempotent guard: if `storage.getActiveSession(userId)` returns non-null, return `{ ok: false, code: 'ACTIVE_SESSION_EXISTS', existing }`. Calls `storage.invalidateDashboard(userId)` (M2 learning #3).
- `LogSetCommand` — pure data write. `sessionService.addSetToExercise`, `storage.cacheActiveSession`, return updated session. Invalidates dashboard.
- `CompleteSetCommand` — `sessionService.completeSet`, persists. Rest-timer trigger is a UI-layer concern; this command is data-only.

**Dependencies:** commits 1-2.

**Test seam:** every command takes `storage: StoragePort` + `idFactory: () => string` as args (no module-global SQLite). Hands-off testability — wrap in-memory storage + a fixed-id factory and assert results.

### Commit 4 — `feat(mobile): session commands (substitute, add-exercise)`

**Phase 3 second slice. Stories 004 + 009.**

Creates:

- `substitute-exercise.command.ts` — old row `isSubstituted: true` (sets preserved per Story-004 AC); new row inserted at `sortOrder + 1` with `originalExerciseId` populated; downstream rows shift down.
- `add-exercise.command.ts` — appends to the session at `max(sortOrder) + 1`. Used for Quick Start + mid-session add.

**Open question** (resolve here, not in BRIEF): when shifting `sortOrder` after insertion, mutate in-memory model only (not the SQLite rows individually) — `cacheActiveSession` performs a full upsert of the session, so the storage layer doesn't see partial updates.

**Dependencies:** commits 1-2.

### Commit 5 — `feat(mobile): rest timer hook + RestTimerDisplay component`

**Phase 4. Story 003.**

Adds dependency:

- `bun add expo-notifications` in `packages/mobile`.
- Add `"expo-notifications"` to `packages/mobile/app.json` `expo.plugins` array.

Creates:

- `packages/mobile/src/ui/hooks/useRestTimer.tsx` — countdown state machine; persists `{ startedAt, totalSeconds }` to SQLite (recommend **inline on `active_sessions`**, not a separate `active_session_timers` table — single-active-session invariant makes the separate table pure overhead). Drift-tolerant: on resume, `remainingSeconds = totalSeconds - (now - startedAt)`.
- `packages/mobile/src/ui/components/session/RestTimerDisplay.tsx` — countdown ring (SVG circle stroke offset using `react-native-svg`). Skip / +30s / +60s / Dismiss controls.
- `packages/mobile/src/adapters/notifications/expo-notifications.adapter.ts` — replaces `stub.adapter.ts` for production. Permission request happens on first session-start, not at app launch (per FRONTEND_BRIEF § Group C). Fallback: in-app countdown only when permission denied.
- Tests with `jest.useFakeTimers()` + `act()`. Notification adapter tested via mocking `expo-notifications`.

**Dependencies:** commit 2 (rest timer state extends `active_sessions` table).

**Risk:** expo-notifications integration on iOS requires entitlement updates — no APNs entitlement needed for **local** notifications, but verify on staging build before merging. Permission-request UX must explain why we're asking (App Store rejection risk for unjustified prompts).

### Commit 6 — `feat(mobile): SetLogger / ExerciseProgress / SessionExerciseCard / SessionHeader / QuickFillSuggestion`

**Phase 5 components. Stories 002 + 005.**

Creates the five presentational components per FRONTEND_BRIEF § Group D. Each has its own folder under `packages/mobile/src/ui/components/session/`, mirroring the workouts/ structure (PR #41 pattern):

```
ui/components/session/
├── SetLogger/
│   ├── SetLogger.tsx
│   └── __tests__/SetLogger.test.tsx
├── ExerciseProgress/
├── SessionExerciseCard/
├── SessionHeader/
├── QuickFillSuggestion/
└── RestTimerDisplay/   ← already created in commit 5
```

**Critical M2 learnings to apply (from BRIEF):**

- **Form state in snake_case** at the `SetLogger` component (M2 learning #6) — mirror `useWorkoutForm.tsx`.
- **Falsy-zero in JSX** (M2 learning #8): every `reps`, `weight`, `rpe`, `duration`, `distance` value can validly be 0. Use `!= null` guards, not truthy checks.

**Source for porting:** legacy `ActiveSetRow.tsx` (179 LOC) → `SetLogger`, `ActiveExerciseRow.tsx` (268 LOC) → `SessionExerciseCard`. Port 1:1; `/frontend-design` polish later.

**Dependencies:** commit 1 (uses `ExerciseSet`, `SessionExercise` types).

### Commit 7 — `feat(mobile): ActiveSessionPresenter + ActiveSessionContainer + /session route`

**Phase 5 wiring. Stories 002 + 005.**

Creates:

- `packages/mobile/src/ui/presenters/ActiveSessionPresenter.tsx` — port from legacy `ActiveWorkoutScreen.tsx` (452 LOC). Header + horizontal-paginated FlatList of `SessionExerciseCard`s + `RestTimerDisplay` overlay + Discard/Finish footer. Confirm-cancel via existing V2 `Popover` (M2 learning #9 — Popover is fine for confirmation, pageSheet is for multi-step nav).
- `packages/mobile/src/ui/containers/ActiveSessionContainer.tsx` — owns `useActiveSession(sessionId)` hook; wraps mutations in commands; calls `rereadCache` (NOT `refresh` — sets only flush on session complete; M2 learning #4); `useFocusEffect(rereadCache)` to pick up substitution / add-exercise modal mutations (M2 learning #5).
- `packages/mobile/src/ui/hooks/useActiveSession.tsx` — new hook. Loads from SQLite; exposes mutation methods.
- `packages/mobile/app/(app)/session/index.tsx` — modal route. `presentation: "modal"`, `headerShown: false`. Reads `?workoutId=` (start) and `?sessionId=` (resume) from `useLocalSearchParams`. Routes through `StartSessionCommand` or `ResumeSessionCommand`.
- `packages/mobile/app/(app)/_layout.tsx` — register the new screen with the modal preset (mirror `workouts/create.tsx`).

**Dependencies:** commits 1-6.

**Test seam:** container test patterns from PR #41's `WorkoutDetailContainer.test.tsx` are the closest reference.

### Commit 8 — `feat(mobile): SessionSummary screen + /session/summary route`

**Phase 6. Story 006.**

Creates:

- `packages/mobile/src/application/commands/session/complete-session.command.ts` — sets status `completed`, computes `totalDurationSeconds`, **enqueues a single `recordSession` intent** carrying the full session payload (root + nested exercises + nested sets — per FRONTEND_BRIEF § Decision recap). Invalidates dashboard. Keeps the active-session SQLite row until the worker confirms server IDs (then clears it).
- `packages/mobile/src/application/commands/session/cancel-session.command.ts` — same shape, status `cancelled`. Logged sets preserved (Story-007 AC).
- `packages/mobile/src/ui/presenters/SessionSummaryPresenter.tsx` — port from legacy `WorkoutSummaryScreen.tsx` (235 LOC). Duration / total volume / exercises completed / sets completed / PR list.
- `packages/mobile/src/ui/containers/SessionSummaryContainer.tsx` — calls `sessionService.calculateSummary` + `sessionService.detectPersonalRecords(session, await storage.getPersonalRecords(userId))`. Save → `CompleteSessionCommand`. Discard → `CancelSessionCommand`.
- `packages/mobile/app/(app)/session/summary.tsx` — pushed on top of the session screen on Finish. Back returns to workouts/home.

**Dependencies:** commits 1-7. Plus the in-memory `getPersonalRecords` implementation from PR #53 — the Summary's predictive detection seeds from `storage.getPersonalRecords(userId)` (cached locally), and the SST adapter's `getPersonalRecords` populates that cache on focus.

**Wire-format invariant:** the bulk-record payload uses `local-…`-prefixed IDs; the worker's response carries server IDs, and `swapLocalSessionId(localId, serverId)` (commit 2) updates SQLite. Pin this with a regression test in commit 9.

### Commit 9 — `feat(mobile): Quick Start + app-launch resume prompt`

**Phase 7-8. Stories 008-009.**

Creates:

- `packages/mobile/src/application/commands/session/resume-session.command.ts` — wraps `storage.getActiveSession(userId)`; returns `null` if none.
- `packages/mobile/src/ui/hooks/useResumeSession.tsx` — calls `ResumeSessionCommand` on mount; exposes `{ session, dismiss, continue }`.
- `packages/mobile/src/ui/components/session/ResumePrompt/ResumePrompt.tsx` — top-level overlay rendered in `(app)/_layout.tsx` alongside `useSyncWorker`. Continue → `/(app)/session?sessionId=<id>`; Discard → `CancelSessionCommand`.
- `packages/mobile/app/(app)/_layout.tsx` — mount `useResumeSession` + render `<ResumePrompt />` when an active session exists.
- Quick Start CTA wired on the workouts tab header (or home — pick during impl). Triggers `StartSessionCommand({})` (no `workoutId`); session opens with empty exercise list and a "+ Add exercise" button that opens `AddExercisePopover` (reuse from M2 — it's the right pageSheet picker per M2 learning #9).

**Two named regression tests** (per FRONTEND_BRIEF § In scope F):

1. Close mid-session → relaunch → state restored exactly. Mock SQLite + AppState.
2. Complete offline → sync queue holds the batched flush → reconnect → flushes. Mock the network adapter to fail then succeed.

**Dependencies:** commits 1-8.

### Commit 10 — `feat(mobile): wire WorkoutsList + WorkoutDetail + Home start CTAs to /session`

**Phase 5 final wiring. Story 001.**

Modifies four files to drop the `/coming-soon` callers:

| File                                                           | Change                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/mobile/src/ui/containers/WorkoutsListContainer.tsx`  | `onStartWorkout` → `router.push('/(app)/session?workoutId=…')` |
| `packages/mobile/src/ui/containers/WorkoutDetailContainer.tsx` | `onStartWorkout` → same                                        |
| `packages/mobile/src/ui/containers/HomeContainer.tsx`          | `onWorkoutStart` → same (currently routes to detail screen)    |
| `packages/mobile/app/(app)/coming-soon.tsx`                    | Drop the `active-session` entry from the COPY map              |

The Recent Activity row tap (`HomeContainer.onActivityPress`) currently routes to `/(app)/(tabs)/workouts`. Punt to M4 (Progress) — leave as-is.

**Dependencies:** commit 7 (the `/session` route must exist before callers route to it).

### Total LOC estimate

- Domain + services + tests: ~600 LOC
- Storage extensions + tests: ~500 LOC
- Commands + tests (8 commands): ~800 LOC
- Rest timer: ~250 LOC
- Components (5): ~600 LOC
- Presenter + container + route: ~500 LOC
- Summary screen: ~400 LOC
- Quick Start + Resume: ~300 LOC
- CTA rewiring: ~50 LOC

**Total: ~4000 LOC across 10 commits.** Single PR. If commit 3 (commands) sprawls past ~700 LOC, split per FRONTEND_BRIEF's note: `3a` start/log/complete-set, `3b` substitute/add-exercise (already done above as 3 + 4), `3c` complete/cancel/resume (already commits 8 + 9).

---

## 3. Open questions to resolve at impl time (don't re-litigate the BRIEFs)

These are decisions the BRIEFs left open — the agent should resolve them in code with a comment citing the rationale, not re-open the design discussion.

1. **Rest-timer persistence: inline on `active_sessions` vs separate `active_session_timers` table.** Recommend **inline** — single-active-session invariant means a separate table is pure overhead. Add `rest_timer_started_at TEXT` and `rest_timer_total_seconds INTEGER` columns to `active_sessions`.
2. **Resume prompt: overlay vs route.** Recommend **overlay** in `(app)/_layout.tsx`, mounted alongside `useSyncWorker`. Routes are for navigation destinations; the prompt is a one-shot launch-time dialog.
3. **Sync queue dependency ordering for piecemeal intents.** Bulk-record (`recordSession`) is the primary path, so dependency-ordering only matters for the M4-future piecemeal intents. Verify FIFO is enough with a regression test in commit 9; punt explicit dependency ordering until M4 actually needs the piecemeal flow.
4. **Substitution at `sortOrder + 1` shifting downstream rows.** Implement via in-memory mutation in `sessionService.substituteExercise`; persist via `storage.cacheActiveSession` (full upsert). Storage layer never sees partial sortOrder updates.
5. **Quick-fill source priority.** In-session previous set → `personalRecords` cache → nothing. Per FRONTEND_BRIEF § Group D — codify in `SetLogger.tsx`.
6. **Exercise tap mid-set behaviour.** M2 learning #11 says push `/(app)/exercises/[id]` on top. Wire it; the route already exists. Adds zero scope.
7. **`AddExercisePopover` reuse for substitution.** Reuse the existing M2 component for both add-exercise and substitute-exercise. The picker UX is the same; only the command at the boundary differs.

---

## 4. Risks + mitigations

| Risk                                                                                                                           | Mitigation                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo-notifications` plugin config breaks the staging build (iOS / Android)                                                    | Add the plugin config in commit 5; rebuild staging via EAS before merging the PR; verify a local notification fires on a TestFlight build.                                                                 |
| The bulk-record intent's payload size exceeds Lambda limits (6MB sync invoke)                                                  | Largest realistic session: ~10 exercises × 10 sets × ~200 bytes/set ≈ 20KB. Far below the limit. Worth a comment in `complete-session.command.ts` noting the bound.                                        |
| Worker FIFO ordering breaks when bulk-record is enqueued alongside other intents (e.g. `cancelSession` for a previous session) | Bulk-record is a single intent; FIFO holds. Add a regression test in commit 9: enqueue `recordSession` for session A, then `cancelSession` for session B, verify both flush in order.                      |
| Resume detection fires on every layout mount, double-prompting on tab switches                                                 | Mount `useResumeSession` in `(app)/_layout.tsx` only — that's a single mount per app session, not per tab. Hook should also gate on a `dismissed` flag stored per app-launch (in-memory ref, not SQLite).  |
| Coverage threshold (90% global) dips when commit 6 adds many new presentational components                                     | Components are mostly trivial render functions; tests cover them via the container's render tree. Aggregate stays ≥ 90% — see M2 learning #12. If a component file dips on branches, that's fine.          |
| Legacy port introduces V1 design tokens that don't match V2                                                                    | Use `workoutsLegacyTheme.ts` shim as reference; create `activeSessionLegacyTheme.ts` if needed during commit 7. `/frontend-design` polish pass after the port lands, not during.                           |
| Local-id swap loses sets that were modified between flush-start and worker-response                                            | The bulk-record path is single-intent; no inter-flush mutation possible (UI is in summary screen, can't log sets). Document this assumption inline. M4 piecemeal-edit flow will need a different strategy. |

---

## 5. First-commit starter (where to literally start)

```bash
# From a fresh main:
git checkout main && git pull --ff-only
git checkout -b feat/m3-frontend-domain-services

# Read these in order before opening any editor:
#   1. specs/05-active-session/requirements.md  (9 stories, source of truth)
#   2. specs/05-active-session/design.md         (domain model, hybrid PR detection)
#   3. specs/milestones/M3-active-session/FRONTEND_BRIEF.md
#   4. specs/milestones/M3-active-session/EXECUTION_PLAN.md  (this file)

# Commit 1 file list:
#   packages/mobile/src/domain/models/session.ts
#   packages/mobile/src/domain/models/index.ts                       (re-export)
#   packages/mobile/src/domain/services/sessionService.ts
#   packages/mobile/src/domain/services/index.ts                     (re-export)
#   packages/mobile/src/domain/services/__tests__/sessionService.test.ts

# Reference files to study while writing:
#   packages/mobile/src/domain/models/workout.ts            (existing shape pattern)
#   packages/mobile/src/domain/services/workout.service.ts  (existing service pattern)
#   persistence-mobile/hooks/useActiveWorkout.tsx           (legacy domain logic — reference only, do not port wholesale)

# Verification before commit:
bun run typecheck
bun run lint
bun --filter @persistence/mobile test sessionService

# Stage + commit only the new files. Do NOT touch other commits' surfaces in this commit.
git add packages/mobile/src/domain/models/session.ts \
        packages/mobile/src/domain/models/index.ts \
        packages/mobile/src/domain/services/sessionService.ts \
        packages/mobile/src/domain/services/index.ts \
        packages/mobile/src/domain/services/__tests__/sessionService.test.ts
git commit -m "feat(mobile): session domain models + pure services"
```

---

## 6. Quality gates (per commit and before PR open)

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun --filter @persistence/mobile test  # 90% aggregate (M2 learning #12)
```

PR description must include:

- The 10-commit shape (this file's § 2) updated for any deviations.
- Loom or screenshot reel covering smoke steps #2, #4, #5, #9, #10 from `SMOKE_TEST.md`.
- Confirmation that the four `/coming-soon` callers are wired and the `active-session` COPY map entry dropped.

---

## 7. When to deviate from this plan

- **Backend gap discovered.** If commit-N implementation reveals that the wire shape needs a backend change (e.g. a flag the server doesn't return), open a backend follow-up PR first; rebase this PR onto it. Do not silently translate field shapes on the client.
- **Design pivot.** If the `recordWorkout`-style bulk flush proves operationally awkward for some flow (e.g. mid-session app crash), surface it in the PR description and on the M3 agent's status note before rewriting; the bulk-record decision is intentional and documented in [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) § 7.
- **Scope creep into M4.** PR carousel, trend charts, measurement edits — these belong to M4. M3 detects PRs and writes them; the display surface is M4's problem.

---

## 8. Definition of done

This milestone is shippable when:

1. All 10 commits land on a single PR titled `feat(mobile): active session — set logger + rest timer + recovery (M3)`.
2. The end-to-end smoke from [`SMOKE_TEST.md`](./SMOKE_TEST.md) passes against staging.
3. Coverage holds at 90% aggregate.
4. Loom shows: start workout → log 3 sets × 3 exercises → rest timer notifies in background → substitute one exercise → finish → summary shows ≥1 PR → reconnect after airplane mode → queue drains → kill app mid-session → relaunch → resume prompt → state restored exactly.
5. `/coming-soon?feature=active-session` is no longer reachable from any caller.
