# M3 — Active Session — FRONTEND BRIEF

You are the mobile agent for **M3 Active Session**. Read [`BRIEF.md`](./BRIEF.md), [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md), and the parent spec [`specs/05-active-session/`](../../05-active-session/) before starting. The smoke test is at [`SMOKE_TEST.md`](./SMOKE_TEST.md).

This brief inherits everything from M2 (PRs #39, #40, #41) and the 14 learnings in `BRIEF.md` § "M2 learnings to apply". Don't re-discover them.

## TL;DR

Build the offline-first set logger. User taps **Start Workout** on a template (or _Quick Start_ for an empty session), lands in `ActiveSessionContainer`, logs sets one-by-one (writes to SQLite immediately, no per-set network), completes through a `SessionSummary` screen that detects PRs **client-side** for the offline UX, then fires **one bulk POST** carrying the full session payload. App-launch detects an unfinished session and prompts to resume.

This is the most offline-critical surface in the app. Every keystroke must persist locally before any UI feedback. The session must survive app backgrounding, device restart, and full network loss.

## Branch + dependency on backend PR

Branch off `main` **after** the backend PR (`feat: session lifecycle audit + gap fills (M3 backend)`) merges. The backend PR ships:

- Schema additions (`is_completed`, `completed_at`, `superset_group`, `is_substituted`, `original_exercise_id`, `updated_at`)
- New endpoints (`GET /sessions?status=in_progress`, `GET /personal-records`)
- Server-side PR detection on session-complete
- Mobile-side `ApiPort` + `sst-api.adapter.ts` extensions (`ApiSessionExercise`, `ApiSession.exercises`, etc.)

Your branch only adds **mobile domain / commands / hooks / UI / app routes / tests**.

If the backend PR is still in flight, you can rebase iteratively — but do **not** speculatively translate field shapes on the client. Wire format is binding.

## Decision recap from the audit (don't re-litigate)

- **PR detection: hybrid.** Client predicts for the summary screen using a locally-cached `personalRecords` slice; server is canonical and reconciles on flush. See [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) § PR-detection decision.
- **Sync cadence: one bulk POST per session, atomic on the server side.** Sets DO NOT enqueue per-log. They don't enqueue per-exercise either. They enqueue as a **single `recordSession` intent** when the user taps **Finish** or **Discard** — payload carries the entire session (root row + all exercises with `sortOrder` / `supersetGroup` / substitution metadata + all sets with `weightKg` / `reps` / `isCompleted`). Backend writes everything in one transaction, runs PR detection inside the same tx, returns the canonical session with server-assigned IDs. Mirrors the legacy app's `recordWorkout` pattern. _The piecemeal `createSession` / `createSessionExercise` / `createSet` endpoints still exist for editing-completed-session use cases — M4 progress edits will use them — but the active-session flush path is bulk-only._
- **Field naming: `sortOrder` not `orderIndex`** (matches existing wire format on workouts). The spec was edited to reflect this.
- **Substitution: never PATCH session_exercise.** When a user swaps an exercise, the local model marks the old `session_exercise` row `isSubstituted = true` and creates a new row with `originalExerciseId` populated. The old row's sets are preserved (per Story-004 AC). On flush, both rows are POSTed independently.

## In scope — Group A: Domain + ports + adapters (foundation)

### Domain models

`packages/mobile/src/domain/models/session.ts`:

```ts
export type SessionStatus = "in_progress" | "completed" | "cancelled";

export interface WorkoutSession {
  id: string; // local- prefix until server returns canonical id
  userId: string;
  workoutId: string | null;
  name: string;
  status: SessionStatus;
  startedAt: string; // ISO
  completedAt: string | null;
  exercises: SessionExercise[];
  notes: string | null;
}

export interface SessionExercise {
  id: string;
  sessionId: string;
  exerciseId: string;
  exerciseName: string; // joined from exercises table for display
  sortOrder: number;
  supersetGroup: number | null;
  isSubstituted: boolean;
  originalExerciseId: string | null;
  notes: string | null;
  sets: ExerciseSet[];
}

export interface ExerciseSet {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null; // 1-10
  durationSeconds: number | null;
  distanceMeters: number | null;
  isCompleted: boolean;
  completedAt: string | null;
}

export interface PersonalRecord {
  id: string;
  exerciseId: string;
  recordType: "one_rep_max" | "volume";
  value: number;
  setId: string | null;
  achievedAt: string;
}

export interface SessionSummary {
  duration: number; // seconds
  totalVolume: number; // sum of weight*reps across completed sets
  exercisesCompleted: number;
  totalExercises: number;
  setsCompleted: number;
  totalSets: number;
  personalRecords: PersonalRecord[];
}
```

### Pure domain services

`packages/mobile/src/domain/services/sessionService.ts`:

- `createSessionFromWorkout(workout: Workout, idFactory: () => string): WorkoutSession`
- `createEmptySession(idFactory: () => string): WorkoutSession`
- `addSetToExercise(session, exerciseId, set): WorkoutSession` — immutable, returns new session
- `completeSet(session, setId, completedAt): WorkoutSession`
- `substituteExercise(session, oldExerciseId, newExercise, idFactory): WorkoutSession` — old row marked `isSubstituted: true`, new row inserted with `originalExerciseId`
- `addExerciseToSession(session, exercise, idFactory): WorkoutSession`
- `calculateSummary(session): SessionSummary` — duration computed off `startedAt`/`completedAt` (or now())
- `calculateVolume(sets: ExerciseSet[]): number` — only completed sets, `weightKg * reps` summed
- `detectPersonalRecords(session, previousRecords): PersonalRecord[]` — Epley 1RM `weightKg * (1 + reps / 30)` + per-set volume, mirrors backend formula in `BACKEND_BRIEF.md` § 3.

100% unit-test coverage on this module. Pure functions; trivial.

### SQLite tables

Extend `packages/mobile/src/adapters/storage/sqlite.adapter.ts`:

```sql
CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workout_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS active_sessions_user_status ON active_sessions(user_id, status);

CREATE TABLE IF NOT EXISTS session_exercises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES active_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  superset_group INTEGER,
  is_substituted INTEGER NOT NULL DEFAULT 0,
  original_exercise_id TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS session_exercises_session ON session_exercises(session_id, sort_order);

CREATE TABLE IF NOT EXISTS exercise_sets (
  id TEXT PRIMARY KEY,
  session_exercise_id TEXT NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  weight_kg REAL,
  reps INTEGER,
  rpe INTEGER,
  duration_seconds INTEGER,
  distance_meters REAL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS exercise_sets_session_exercise ON exercise_sets(session_exercise_id, set_number);

CREATE TABLE IF NOT EXISTS personal_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  value REAL NOT NULL,
  set_id TEXT,
  achieved_at TEXT NOT NULL,
  UNIQUE(user_id, exercise_id, record_type)
);
```

ID strategy: `local-`-prefixed UUIDs (matching the workouts pattern in PR #41), swapped for server IDs by the sync worker post-flush.

### `StoragePort` extensions

`packages/mobile/src/domain/ports/storage.port.ts`:

- `getActiveSession(userId): Promise<WorkoutSession | null>` — joins all three tables, returns the in-progress session if any.
- `cacheActiveSession(userId, session): Promise<void>` — upsert root + nested rows.
- `clearActiveSession(userId): Promise<void>` — delete the in-progress session and cascade.
- `getSessionSets(userId, sessionId, exerciseId): Promise<ExerciseSet[]>` — for quick-fill suggestions when no PR cache exists.
- `cachePersonalRecords(userId, records): Promise<void>` — upsert by unique key.
- `getPersonalRecords(userId, exerciseId?): Promise<PersonalRecord[]>` — feeds the Summary screen detector + quick-fill.
- `invalidateDashboard(userId)` — already exists; called by every session-mutating command (M2 learning #3).

The in-memory test adapter at `packages/mobile/src/adapters/storage/__tests__/in-memory-storage.adapter.ts` mirrors all of these.

### Sync intent kinds

`packages/mobile/src/application/commands/sync.command.ts` already supports generic POST/PATCH/DELETE. The new intent shapes are:

| Kind                    | Endpoint                             | Method | Body                                                        |
| ----------------------- | ------------------------------------ | ------ | ----------------------------------------------------------- |
| `createSession`         | `/sessions`                          | POST   | session core fields                                         |
| `createSessionExercise` | `/sessions/:sid/exercises`           | POST   | exercise + supersetGroup, isSubstituted, originalExerciseId |
| `createSessionSet`      | `/sessions/:sid/exercises/:eid/sets` | POST   | set fields                                                  |
| `updateSession`         | `/sessions/:sid`                     | PATCH  | `{ status, completedAt, totalDurationSeconds, userNotes }`  |

Replay must be **dependency-ordered**: a session's exercise creates depend on its session create, and set creates depend on the parent exercise create. The worker today is FIFO — confirm that's enough (since enqueue order is dependency order). If the worker reorders, add a per-batch dependency hint. **Verify with a regression test before relying on FIFO ordering**.

ID swapping: when `createSession` returns a server `id`, the worker rewrites the local `local-…` prefix to the server id in all queued intents that reference it. Pattern already used by workouts in PR #41 — reuse the helper if abstractable; copy with a comment if not.

## In scope — Group B: Application commands

`packages/mobile/src/application/commands/session/`:

- `start-session.command.ts` — `StartSessionCommand({workout?, exercises?})` writes to SQLite, no enqueue. Returns the created `WorkoutSession`. Idempotent guard: if an active session already exists for the user, returns `{ ok: false, error: 'ACTIVE_SESSION_EXISTS' }` with the existing session attached so the caller can prompt resume-or-discard.
- `log-set.command.ts` — writes the set row immediately, returns the updated session.
- `complete-set.command.ts` — flips `isCompleted: true`, sets `completedAt: new Date().toISOString()`, returns the updated session. Trigger for the rest timer is a separate UI-layer concern; this command is pure-data.
- `substitute-exercise.command.ts` — old exercise marked `isSubstituted: true`; new row with `originalExerciseId` inserted at the same `sortOrder + 1` (existing rows shifted down).
- `add-exercise.command.ts` — appends an exercise to the session.
- `complete-session.command.ts` — sets `status: 'completed'`, `completedAt: now()`, computes `totalDurationSeconds`, **enqueues a single `recordSession` intent** carrying the full session payload (root + nested exercises + nested sets — see § "Bulk-record wire format" below for the exact shape), invalidates dashboard, then keeps the active-session SQLite row until the sync flush confirms server-assigned IDs (then clears it on the worker's reply path).
- `cancel-session.command.ts` — same shape as complete but `status: 'cancelled'`. Logged sets are preserved (Story-007 AC).
- `resume-session.command.ts` — wraps `storage.getActiveSession(userId)`; returns `null` if none.

Every one of these (except `resume`) calls `storage.invalidateDashboard(userId)` (M2 learning #3). Pure functions delegate to `sessionService.*`; commands are the imperative layer that owns SQLite + queue side-effects.

## In scope — Group C: Rest timer

- `useRestTimer` hook at `packages/mobile/src/ui/hooks/useRestTimer.tsx`:
  - State: `{ isActive, remainingSeconds, totalSeconds, progress: 0..1 }`.
  - Methods: `start(seconds)`, `extend(seconds)`, `skip()`, `dismiss()`.
  - Persists to SQLite (`active_session_timers` single-row table or in-line on `active_sessions`) so it survives backgrounding.
  - Drift-tolerant: on resume, reconciles against `wall-clock - timer.startedAt`.
  - Auto-start configurable via a session-level prop (default-on for completing a set; default-off for ad-hoc).
- Local notification fires when timer reaches 0:
  - Use `expo-notifications`. Permission request happens on first session-start (not at app launch), with a fallback path if denied (no notification, in-app countdown only).
  - Notification payload: title "Rest complete", body `${exerciseName} — set ${n+1} ready`.
  - Cancel pending notification when user taps **Skip** or **Dismiss**.
- `RestTimerDisplay` presenter at `packages/mobile/src/ui/components/session/RestTimerDisplay.tsx`:
  - Countdown ring (SVG circle stroke offset).
  - Skip / Extend (+30s, +60s) / Dismiss controls.
  - Render only when `isActive`. Falsy-zero guard: `remainingSeconds != null && ...` (M2 learning #8).

## In scope — Group D: Active session UI

`packages/mobile/src/ui/components/session/`:

- `SetLogger.tsx` — weight / reps / RPE inputs (RPE 1-10 horizontal picker), Mark Complete button.
  - Quick-fill: when the user focuses an empty set's weight, fill from the last completed set on the same exercise (in-session first, fall back to `personalRecords` cache, fall back to nothing).
  - **Form-state in snake_case at the component, camelCase at the boundary** (M2 learning #6) — mirror `useWorkoutForm.tsx`'s pattern.
  - **Falsy-zero in JSX** (M2 learning #8): `{reps != null && <Text>{reps}</Text>}`. RPE, reps, weight can all validly be 0 in some inputs.
- `ExerciseProgress.tsx` — sets-completed / total-target indicator.
- `SessionExerciseCard.tsx` — exercise header + list of `SetLogger` rows + "+ Add set" button + overflow menu (Substitute, Notes).
- `SessionHeader.tsx` — session-duration timer (live), exercise-progress indicator (e.g. 3/6), nav controls.
- `QuickFillSuggestion.tsx` — "Last time: 80kg × 8" hint above empty inputs.

`packages/mobile/src/ui/presenters/ActiveSessionPresenter.tsx`:

- Stack-based layout: header at top, current `SessionExerciseCard` body, `RestTimerDisplay` overlaying the bottom when active, footer with **Discard** + **Finish** CTAs.
- Swipe between exercises (FlatList horizontally with `pagingEnabled`, or `react-native-pager-view` if already in deps).
- Tap-to-jump: a horizontal scrollable strip of exercise tabs.
- Superset cycling: exercises with the same `supersetGroup` cycle on tap-next inside the group before advancing.

`packages/mobile/src/ui/containers/ActiveSessionContainer.tsx`:

- Owns `useActiveSession(sessionId)` hook (new) which loads the SQLite session and exposes mutation methods.
- Wraps each mutation in the corresponding command, then `rereadCache` (NOT `refresh` — sets only flush on session complete; M2 learning #4).
- `useFocusEffect(rereadCache)` to pick up substitution / add-exercise mutations made inside picker modals (M2 learning #5).
- Confirm-cancel flow: tapping Discard opens a `Popover` ("Discard this session?") — use the V2 `Popover` per M2 learning #9 (this is a confirmation, not multi-step nav).

`packages/mobile/app/(app)/session/index.tsx`:

- Modal route, `presentation: "modal"`, `headerShown: false` (in-screen header). Same pattern as M2 modal screens.
- Reads `?workoutId=` and `?sessionId=` from `useLocalSearchParams`. If `sessionId` present (resume flow), loads it; if `workoutId` present (start flow), seeds from the workout template via `StartSessionCommand`.

`packages/mobile/app/(app)/_layout.tsx` — register the new screen with the modal preset (mirror the workout-create / workout-edit registrations).

### Wire `/coming-soon` replacements

Per `BRIEF.md` § "/coming-soon stubs M3 must replace":

| File                                    | Current                                           | New                              |
| --------------------------------------- | ------------------------------------------------- | -------------------------------- |
| `WorkoutsListContainer.onStartWorkout`  | `/coming-soon?feature=active-session`             | `/(app)/session?workoutId=<id>`  |
| `WorkoutDetailContainer.onStartWorkout` | `/coming-soon?feature=active-session&workoutId=…` | `/(app)/session?workoutId=<id>`  |
| `HomeContainer.onWorkoutStart`          | `/(app)/workouts/<id>` (M3 stub)                  | `/(app)/session?workoutId=<id>`  |
| `app/(app)/coming-soon.tsx`             | `active-session` COPY entry                       | drop after all four routes wired |

Recent Activity row tap (`HomeContainer.onActivityPress`) currently routes to the workouts tab. Punt to M4 — leave it as-is until the Progress milestone ships the completed-session detail surface.

## In scope — Group E: Session Summary

- `SessionSummaryPresenter.tsx` — duration, total volume, exercises completed, sets completed, PR list (icon + value).
- `SessionSummaryContainer.tsx` — calls `sessionService.calculateSummary` + `sessionService.detectPersonalRecords(session, await storage.getPersonalRecords(userId))`. Triggers `CompleteSessionCommand` on confirm; `CancelSessionCommand` on discard.
- Confirmation dialog ("Save workout?" / "Discard?").
- `app/(app)/session/summary.tsx` — pushed on top of the session screen on Finish. Back returns to workouts/home (modal stack collapses).

## In scope — Group F: Quick start + recovery

- **Quick Start** entry point — add a button on the workouts tab header or on the home tab "Start workout" cluster. Triggers `StartSessionCommand({})` (no workoutId). The session opens with an empty exercise list and a "+ Add exercise" CTA that opens the exercise picker (reuse `AddExercisePopover` from M2; it's the right multi-step picker per M2 learning #9).
- **App-launch resume detection**:
  - In `(app)/_layout.tsx`, alongside `useSyncWorker`, mount `useResumeSession()` hook that calls `ResumeSessionCommand` on mount.
  - If an in-progress session exists, render a top-level `<ResumePrompt session={…} />` overlay with **Continue Push Day** / **Discard** options.
  - Continue → routes to `/(app)/session?sessionId=<id>`.
  - Discard → fires `CancelSessionCommand`, prompt dismisses.
- **Tests** — `BRIEF.md` § Quick Start + recovery names two specific scenarios:
  - Close mid-session → relaunch → state restored exactly (write a deterministic Jest test; mock SQLite + AppState).
  - Complete offline → sync queue holds the batched flush → reconnect → flushes (mock the network adapter to fail then succeed).

## Out of scope (don't pull in)

Per `BRIEF.md` § "Out of scope":

- **PR carousel + trend chart UI** — M4 owns those. M3 only writes PR rows (server) and shows them on the summary screen.
- **Progress tab updates** beyond the existing `recentActivity` + `progress.workoutsThisMonth` slices — M4 owns measurements + stat tiles.
- **Drag-and-drop set reordering** — M11.
- **Per-exercise default rest time configurator** — M6 (Profile/Settings) ships the surface; M3 just consumes the global default + reads any per-exercise default from the workout template.
- **Trainer-locked target sets** — M8.
- **Subscription gating** — M10.

## M2 learnings to surface again (do NOT re-discover)

These were paid for in M2 and are listed in full in [`BRIEF.md`](./BRIEF.md) § "M2 learnings to apply". Quick checklist:

1. **Sync queue drains in every refresh** — `useSession.refresh`, `useSessionHistory.refresh` must call `processSyncQueue` first.
2. **Worker already runs.** `useSyncWorker` mounted in `(app)/_layout.tsx`. Verify your new intent kinds replay.
3. **`storage.invalidateDashboard(userId)` on every mutating command.**
4. **`rereadCache`, not `refresh`, for in-tab mutations.** Sets only flush on session complete — `LogSet`/`CompleteSet` must use `rereadCache`.
5. **Tab focus → `useFocusEffect(rereadCache)`.** Apply on session-history view if added.
6. **Form state in snake_case, camelCase at boundary.** SetLogger inputs.
7. **`generateId` in `useCallback([])`. Tighten downstream `useCallback` deps to specific methods.**
8. **Falsy zero in JSX `&&`.** Reps, weight, RPE, duration, distance ALL can be 0.
9. **Picker / multi-step modal: `pageSheet` Modal**, not centered `Popover`. Substitution picker, RPE picker.
10. **Detail surface = real route.** Session screen + summary screen are real routes, not overlays.
11. **Exercise tap → stacked `/(app)/exercises/[id]`.** If the user wants form cues mid-set, push the exercise detail screen on top.
12. **Coverage: 90% global aggregate.** New files can have low branches as long as aggregate stays ≥ 90.
13. **CI flake mitigations:** `afterEach(jest.restoreAllMocks)`, `mock`-prefixed factories, no re-export-only files, explicit 30s timeouts on cascading-async tests.
14. **TOCTOU** is a backend concern; doesn't apply here, but be alert to client-side equivalents (don't trust local state across async gaps where the data could change).

## Planned commit shape (post in PR description before pushing impl commits)

1. `docs(M3): frontend brief + spec touch-ups` — only if the backend PR's spec edits don't already cover the frontend angle. Likely a no-op once backend lands.
2. `feat(mobile): session domain models + pure services` — Group A § Domain models + Domain services. 100% unit test coverage.
3. `feat(mobile): SQLite tables + StoragePort extensions` — Group A § SQLite + storage. Adapter tests + in-memory mirror.
4. `feat(mobile): session commands (start, log, complete-set, substitute, add-exercise, complete, cancel, resume)` — Group B. Each command tested in isolation.
5. `feat(mobile): rest timer hook + RestTimerDisplay component` — Group C, including notification permission flow.
6. `feat(mobile): SetLogger / ExerciseProgress / SessionExerciseCard / SessionHeader / QuickFillSuggestion` — Group D presentational components.
7. `feat(mobile): ActiveSessionPresenter + ActiveSessionContainer + /session route` — Group D wiring.
8. `feat(mobile): SessionSummary screen + /session/summary route` — Group E.
9. `feat(mobile): Quick Start + app-launch resume prompt` — Group F. Includes the close-relaunch-restore test and the offline-flush test.
10. `feat(mobile): wire WorkoutsList + WorkoutDetail + Home start CTAs to /session` — drop the four `/coming-soon` callers.

10 commits. Each cites the parent spec section it implements (`05-active-session/requirements.md` Story-NNN, `design.md` § Domain Model, etc.).

If 4 sprawls past ~700 LOC, split commands by lifecycle phase: `4a` start/log/complete-set, `4b` substitute/add-exercise, `4c` complete/cancel/resume.

## Quality gates

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun --filter @persistence/mobile test  # 90% aggregate
```

`coverageThreshold` is global aggregate (M2 learning #12) — new files can dip on branches as long as the aggregate holds.

## Smoke (frontend slice — full e2e in [SMOKE_TEST.md](./SMOKE_TEST.md))

Every PR claim of "done" must include:

1. Run mobile in `bun run dev` against staging API.
2. Tap **Start Workout** on a Push Day template → land on session screen with first exercise ready.
3. Log 3 sets × 3 exercises with rest timer between sets. Confirm timer notifies even with app backgrounded.
4. Substitute one exercise mid-session. Confirm old sets remain in history; new exercise has zero sets.
5. Tap **Finish Workout** → summary shows duration, volume, completed counts, **at least one PR detected client-side** (use a heavier weight than your previous PR).
6. Confirm save → returns to home/workouts. Recent Activity row shows the just-completed session.
7. Verify the session is queued in sync (open `__sync_queue__` table or Devtools).
8. Online: queue flushes, server returns canonical PR. Local cache reconciles next focus.
9. Offline path: airplane mode → start a quick session → log a set → complete → summary still renders → reconnect → queue drains.
10. Backgrounding: start a session, log 1 set, kill app, relaunch → resume prompt fires → continue → state matches exactly.

Include a Loom or short screenshot reel covering #2, #4, #5, #9, #10 in the PR body.

## Coordinate

If implementation reveals the wire shape needs further changes (e.g. you need a flag the backend doesn't return), surface it on the backend PR before this one lands. Don't translate field shapes silently.

If you discover a need for an endpoint not in `BACKEND_BRIEF.md` (e.g. a bulk-set POST for performance), bridge it via a tiny backend follow-up PR, not by hacking around it client-side.
