# M3 — Active Session (offline-critical) — BRIEF

You are the agent picking up Milestone 3. The workouts surface (M2) shipped end-to-end (PRs [#39](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/39) + [#40](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/40) + [#41](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/41)). Your job is to ship the **active session** experience: a user taps Start Workout on a template, lands in a live set logger with a rest timer, logs sets one-by-one (offline-first to SQLite), and finishes with a summary screen that detects PRs and queues the session for sync.

This is the most offline-critical surface in the app. Every set logged must persist locally before any UI feedback; the session must survive app backgrounding, device restart, and full network loss. Sync happens on session complete/cancel — one batched push per session, not per-set.

Read the parent spec **[`specs/05-active-session/`](../../05-active-session/)** in full before starting (`requirements.md` → 9 stories with ACs, `design.md` → domain model + state machine + UI tree, `tasks.md` → 9 phases, currently 0/~50 ticked).

## Branch + workflow

Two branches off fresh `main` (after PR #41 merges) — one backend, one frontend — per the M0 / M2 pattern. Decide the split based on the audit pass below:

- **Backend branch:** audit existing session handlers under `microservices/core/src/application/sessions/{create,get,list,update,delete}` + nested `sessions/exercises/*` + `sessions/sets/*`. They're tested and wired, but the spec mentions client-vs-server PR detection as an open decision (`tasks.md` Phase 6) — pick one and document. Likely small: maybe a couple of helper endpoints (e.g. `GET /sessions/active`, `GET /personal-records?exerciseId=X` for set quick-fill) if the mobile side surfaces a need.
- **Frontend branch:** the bulk of the work. Mobile foundation (domain + SQLite + commands + hooks + sync intents) + UI (`ActiveSessionContainer` + `SetLogger` + `RestTimerDisplay` + `SessionSummary`) + recovery flow (resume prompt on app launch).

If the backend audit reveals zero gaps, that branch ships as a tiny verification-only PR and the milestone is effectively single-PR. If it reveals real gaps, ship them first so the mobile branch can rebase onto the additive backend changes without conflict. Decide after the audit.

**PR title pattern:**
- Backend: `feat: session lifecycle audit + gap fills (M3 backend)`
- Frontend: `feat(mobile): active session — set logger + rest timer + recovery (M3)`

### Audit complete (2026-05-02)

Audit landed real backend gaps — this is **not** a verification-only PR. See [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) for the full status note + planned commit shape; [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) for the mobile contract; [`SMOKE_TEST.md`](./SMOKE_TEST.md) for the merge gate. Headlines:

- Schema needs additive columns: `exercise_sets.is_completed` + `completed_at`, `session_exercises.superset_group` + `is_substituted` + `original_exercise_id`, `workout_sessions.updated_at`.
- `GET /sessions` needs a `status` query filter for the resume-on-launch flow.
- New `GET /personal-records` endpoint required for quick-fill + offline PR detection.
- Server-side PR detection lands in `sessionsUpdateHandler` on the `in_progress → completed` transition (Epley 1RM + volume; idempotent upsert).
- Client-side PR detection runs in parallel for the offline Summary screen UX (hybrid model — see `design.md` § "Personal-record detection: hybrid").
- TOCTOU regression on `updateSet` / `deleteSet` — fold ownership into the mutation WHERE per M2 learning #14.
- Wire-format field naming kept as `sortOrder` (not renamed to `orderIndex`) for consistency with M2; spec edited to match.

## What you're inheriting (foundation, already done)

### Backend (M3 may verify, gap-fill, but mostly already there)

- **Session lifecycle handlers** at `microservices/core/src/application/sessions/`:
  - `POST /sessions` (create), `GET /sessions/:id`, `GET /sessions` (list, paginated), `PATCH /sessions/:id` (update — status, notes, completedAt), `DELETE /sessions/:id`.
  - `POST /sessions/:id/exercises`, `GET /sessions/:id/exercises/:id`, `DELETE /sessions/:id/exercises/:id`.
  - `POST /sessions/:id/exercises/:exerciseId/sets`, `GET .../sets/:setId`, `PATCH .../sets/:setId`, `DELETE .../sets/:setId`.
- **JWT ownership** scoped on every handler (M2 patterns hold — fold ownership into the WHERE clause for mutations, see learning #14 below).
- **`ApiPort` stubs** on mobile (`packages/mobile/src/domain/ports/api.port.ts`): `getSessions`, `getSession`, `createSession`, `updateSession`, `deleteSession`, `createSet`, `updateSet`. Implementations exist in `sst-api.adapter.ts` for some (verify completeness — these were stubbed when the port was first declared).

### Mobile infrastructure (M3 reuses, doesn't rebuild)

- **Sync queue worker** — `useSyncWorker` ([packages/mobile/src/ui/hooks/useSyncWorker.tsx](../../../packages/mobile/src/ui/hooks/useSyncWorker.tsx)) drains `processSyncQueue` on launch + AppState `change → active`. M3 mutations land in the same queue and replay through the same worker. No new wiring needed unless you introduce a different transport.
- **`processSyncQueue`** at `packages/mobile/src/application/commands/sync.command.ts` — generic POST/PATCH/DELETE replayer. M3 enqueues `entityType: "session"` / `"sessionExercise"` / `"sessionSet"` intents and the worker handles them generically.
- **`StoragePort`** at `packages/mobile/src/domain/ports/storage.port.ts` — already supports cross-cache invalidation (`invalidateDashboard`). M3 will add `getActiveSession`, `cacheActiveSession`, `clearActiveSession`, plus the SQLite tables; same pattern as the workouts cache surface that PR #40 added.
- **`useFocusEffect → rereadCache`** pattern, applied on workouts + home tabs in PR #41. M3's session changes will affect home (`recentActivity`, `progress.*`, streak) — every session-mutation command must call `storage.invalidateDashboard(userId)` and the home tab's existing focus-effect picks it up.
- **Theme shim** — `workoutsLegacyTheme.ts` (re-exports V2 tokens via the legacy API). M3 will add an active-session-specific shim if needed (`activeSessionLegacyTheme.ts`?) — or extend the existing one. Check the legacy session screen's theme imports first.
- **Modal stack patterns** from M2 — `app/(app)/_layout.tsx` registers modal screens with `presentation: "modal"`, `headerShown: false`, custom in-screen headers. The active session screen will follow the same pattern.

### `/coming-soon` stubs M3 must replace

PR #41 wired four CTA paths to `/coming-soon?feature=active-session`. M3 replaces all four:

| File | Handler | Current target | M3 target |
|---|---|---|---|
| [`packages/mobile/src/ui/containers/WorkoutsListContainer.tsx:onStartWorkout`](../../../packages/mobile/src/ui/containers/WorkoutsListContainer.tsx) | "Start" button on `WorkoutCard` | `/coming-soon?feature=active-session` | `/(app)/session?workoutId=X` (start a session from this template) |
| [`packages/mobile/src/ui/containers/WorkoutDetailContainer.tsx:onStartWorkout`](../../../packages/mobile/src/ui/containers/WorkoutDetailContainer.tsx) | "Start Workout" CTA at the bottom of detail screen | `/coming-soon?feature=active-session&workoutId=X` | same `/(app)/session?workoutId=X` |
| [`packages/mobile/src/ui/containers/HomeContainer.tsx:onWorkoutStart`](../../../packages/mobile/src/ui/containers/HomeContainer.tsx) | (currently routes to detail screen as M3 stub — replace with direct session start) | `/(app)/workouts/<id>` | `/(app)/session?workoutId=X` |
| [`packages/mobile/app/(app)/coming-soon.tsx`](../../../packages/mobile/app/(app)/coming-soon.tsx) | `active-session` COPY map entry | retained as fallback | drop the `active-session` entry once all four callers route to the real screen |

The Recent Activity row tap on home (`onActivityPress`) currently routes to `/(app)/(tabs)/workouts`. Decide what M3 does with it — likely opens a completed-session detail view, or stays a stub for M4 (Progress) to wire.

## What you're building (in scope)

The full parent spec — 9 stories, 9 phases. Below is an opinionated grouping by ship-cadence, not a rigid contract. Implementation commits should track this grouping for cleaner reviews.

### Group A — Domain + ports + adapters (foundation)

- `WorkoutSession`, `SessionExercise`, `ExerciseSet`, `SessionSummary` domain models.
- Pure domain services: `createSessionFromWorkout`, `createEmptySession`, `addSetToExercise`, `completeSet`, `substituteExercise`, `addExerciseToSession`, `calculateSummary`, `calculateVolume`, `detectPersonalRecords`.
- SQLite tables: `active_sessions`, `session_exercises`, `exercise_sets`. ID strategy: `local-`-prefixed UUIDs (matching the workouts pattern in PR #41), swapped for server IDs by the sync worker post-flush.
- `StoragePort` extensions: `getActiveSession(userId)`, `cacheActiveSession(userId, session)`, `clearActiveSession(userId)`, `getSessionSets(userId, sessionId, exerciseId)` for quick-fill.
- `ApiPort` completion: verify the seven existing stubs are implemented; add any methods the mobile commands need (e.g. `getActiveSession()`, `getPersonalRecords(exerciseId)` if quick-fill needs server-side history).
- Sync queue intent kinds: `createSession`, `updateSession`, `createSessionSet`, `updateSessionSet`, `deleteSessionSet`. The worker is generic — these just need valid `entityType`s with correct `endpoint` + `method`.

### Group B — Commands

- `StartSessionCommand` (from workout template OR empty for quick-start) — writes to SQLite, no enqueue yet (sync happens on complete/cancel per the spec).
- `LogSetCommand` — writes set to SQLite immediately. No enqueue per-set.
- `CompleteSetCommand` — marks set complete + triggers rest timer.
- `SubstituteExerciseCommand`, `AddExerciseCommand`.
- `CompleteSessionCommand` — finalize, calculate summary, **enqueue all writes to sync queue at once** (one batched flush per session, per `design.md § Offline Resilience`).
- `CancelSessionCommand` — mark cancelled, enqueue PATCH.
- `ResumeSessionCommand` — load active session from SQLite on app launch.
- All session-mutating commands invalidate the dashboard cache (per learning #3 below).

### Group C — Rest timer

- `useRestTimer` hook — countdown, progress (0..1), auto-start option, persists state for background survival.
- Local notification (expo-notifications) when timer completes — fires even with app backgrounded. Requires `expo-notifications` config + permission request flow (decide whether to ask on session start or earlier).
- `RestTimerDisplay` component — countdown ring, skip / extend / dismiss controls.

### Group D — Active session UI

- `SetLogger` — weight / reps / RPE inputs (RPE 1-10 picker), complete button. Quick-fill suggestions from previous-session values (server-side or client-side cache — decide based on offline constraints).
- `ExerciseProgress`, `SessionExerciseCard`, `SessionHeader`, `QuickFillSuggestion`.
- `ActiveSessionPresenter` + `ActiveSessionContainer` — full session screen, exercise navigation (swipe + tap), superset cycling.
- `app/(app)/session/index.tsx` — modal route, `presentation: "modal"`, `headerShown: false` (in-screen header owned by the presenter, matching M2 pattern).
- Confirm-cancel flow ("Discard this session?").

### Group E — Session summary

- `SessionSummaryPresenter` + `SessionSummaryContainer` — duration, total volume, exercises completed, sets completed, PRs detected.
- Confirmation dialog (save / discard).
- `app/(app)/session/summary.tsx` route — pushed on top of session on complete, back returns to workouts/home.

### Group F — Quick start + recovery

- "Quick Start" entry point — empty session, can add exercises on-the-fly.
- App-launch active-session detection. Resume prompt ("Continue Push Day?") with resume / discard options. Lives in the `(app)` layout root or a new screen — your call.
- Test: close mid-session → relaunch → state restored exactly. Test: complete offline → sync queue holds the batched flush → reconnect → flushes.

## Out of scope (don't pull in)

- **Personal-records analytics surface** — M4 owns the PR carousel and trend chart. M3 only **detects** PRs at session complete and writes them to a PR record (server-side or local — your design call). The display surface is M4's problem.
- **Progress tab updates** — M4 owns measurements + stat tiles. M3's session completion will update the dashboard's `recentActivity` and `progress.workoutsThisMonth` slices via the existing `invalidateDashboard` pattern; that's it.
- **Drag-and-drop set reordering** — M11 polish.
- **Per-exercise default rest time** UI — STORY-003 AC mentions "Default rest time configurable per exercise or globally" but the configuration surface lives in M6 (Profile/Settings). M3 just consumes a global default + reads any per-exercise default that the workout template already carries.
- **Trainer-assigned session enforcement** (e.g. "trainer locked target sets") — M8 (Trainer Features).
- **Subscription gating on session count** — M10 (Subscriptions).

## M2 learnings to apply (do NOT re-discover)

These were paid for in PRs #39 + #40 + #41. Burned a CI cycle each — surface them again on M3.

1. **Sync queue must drain inside every refresh that fetches user-mutable state.** `useWorkouts.refresh` and `useDashboard.refresh` both call `processSyncQueue` before the GET. M3 will add hooks (e.g. `useSession(id)` for the session-detail view, possibly `useSessionHistory()`) — every refresh on those hooks must drain the queue first to avoid the create-then-refresh race that drops optimistic rows or zombie-restores deletes.

2. **Sync queue worker has to actually run.** Already does — `useSyncWorker` mounted at `(app)/_layout.tsx`. M3 doesn't need new wiring unless it introduces a different transport. Verify the worker picks up your new intent kinds.

3. **Cross-cache invalidation on writes.** Session mutations affect the dashboard's `recentActivity` and `progress.*` slices. Every command in Group B above must call `storage.invalidateDashboard(userId)` (the helper added in PR #41) so the home tab refreshes on focus.

4. **In-tab mutations need `rereadCache`, NOT `refresh`.** When you mutate cache locally (e.g. log a set), the snapshot needs to re-read but should NOT round-trip to the server (the queued mutation hasn't flushed yet — sets only flush on session complete per spec). Pattern: expose `rereadCache` on any new hook that owns mutable state; call it after `LogSetCommand` etc.

5. **Tab focus must trigger a cache re-read.** `useFocusEffect(rereadCache)` on container roots. M3 might not need this on the session screen itself (it owns its own state machine via SQLite), but if you add a session-history list or a separate sets-history view, wire it.

6. **Form-state hooks: snake_case at the form, camelCase at the boundary.** The verbatim-ported set logger components likely consume snake_case (`weight_kg`, `target_reps`, `is_completed`). Mirror the M2 pattern: keep the form reducer's state in legacy snake_case, convert at the submit boundary. See `packages/mobile/src/ui/hooks/useWorkoutForm.tsx` for the reference.

7. **`generateId` in `useCallback([])`.** Every container that owns optimistic-id generation should wrap the factory in `useCallback`-with-empty-deps. Tighten downstream `useCallback` deps to specific methods (`form.addSet`) rather than the full hook handle (`form`). Cascading-rerender bug surfaced on PR #41.

8. **Falsy zero in JSX `&&`.** `{n && <View />}` renders the literal `0` when `n === 0`. Use `n != null && ...` for any number that can validly be zero. M3 has rep-counts, weights, durations, distances that can ALL be zero — flag in code review.

9. **Picker / multi-step modal presentation: `pageSheet` Modal, not centered `Popover`.** The V2 `Popover` overlay is fine for confirmation dialogs. For navigation steps inside a modal flow (e.g. exercise substitution picker, RPE selector), use `<Modal animationType="slide" presentationStyle="pageSheet">` with a back-arrow header. See `AddExercisePopover` (M2) for the reference.

10. **Detail surface: real route, not in-list overlay.** PR #41 converted the workout-detail popover into a real route (`/(app)/workouts/[id]`). M3's session screen IS a real route by design (`/(app)/session/index.tsx`); the summary should be too (`/(app)/session/summary.tsx`). Avoid overlay popovers for anything the user might want to deep-link or stack-navigate from.

11. **Exercise-click stacked navigation pattern.** Inside the workout-detail screen, tapping an exercise pushes `/(app)/exercises/[id]` on top — the workout sits underneath, back returns to it. Same pattern available for M3 if the user wants to view exercise details (form cues, video) mid-set.

12. **Coverage threshold is global aggregate** (still). Mobile `package.json`'s `coverageThreshold: { global: { branches/functions/lines/statements: 90 } }`. New files can have low branches as long as the aggregate stays ≥90.

13. **CI flake learnings** (still):
    - `afterEach(jest.restoreAllMocks)` — `clearAllMocks` does NOT reset implementations.
    - `jest.mock(...)` factory captures must be `mock`-prefixed.
    - Re-export-only files register 0% coverage — use local aliases.
    - Explicit 30s timeout (`it("...", async () => {...}, 30_000)`) on cascading-async-await tests where loaded CI workers blow the 5s default.

14. **TOCTOU on ownership-checked mutations** (still). Fold ownership into the WHERE: `update(...).where(and(eq(id), eq(createdBy, userId)))`. Single round-trip, race-free, 404 from the same code path. Backend session handlers already do this; verify your audit doesn't regress it.

## Coordinate

If you discover a wire-format gap (e.g. backend `POST /sessions` doesn't accept the field shape the mobile commands need), raise it in the PR description and bridge it on the backend branch first — don't silently translate on the client. The session contract is binding for both sides.

If the backend audit + gap-fill ends up tiny (e.g. <100 LOC), ship it as a single-commit PR and rebase the frontend onto it before merging. If it's substantial (e.g. PR-detection logic ends up server-side), ship it as a proper standalone PR with its own smoke section.

Bias toward shipping. The session is the heart of the app — get it logging sets reliably first, polish later.

---

## When this milestone kicks off

1. **Re-read this brief + the parent spec** [`05-active-session/`](../../05-active-session/) end-to-end.
2. **Audit the backend session handlers** — write a 1-paragraph status note in your PR description. Decide PR-detection placement (client vs. server) before writing the first frontend command.
3. **Branch off fresh `main`.** Two branches; or one if the backend audit shows zero gaps.
4. **Author `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`** in this folder before any code commits. Each cites the parent spec sections it implements. The smoke test must walk a full happy-path session end-to-end (start → log 3 exercises × 3 sets with rest timer → finish → see summary → confirm session in history) plus the offline + recovery cases.
5. **Post a planned commit shape** (3–7 commits per PR) in the PR description before pushing implementation commits — same discipline as PR #41.

Good luck. The next agent reading this should be able to start within ~30 minutes of the M2 PR #41 merge.
