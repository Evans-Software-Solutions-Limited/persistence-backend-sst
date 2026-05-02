# 05 — Active Session: Technical Design

## Domain Model

```typescript
// src/domain/models/session.ts
export interface WorkoutSession {
  id: string;
  userId: string;
  workoutId: string | null; // null for quick sessions
  workoutName: string;
  status: SessionStatus;
  startedAt: string;
  completedAt: string | null;
  exercises: SessionExercise[];
  notes: string | null;
}

export type SessionStatus = "in_progress" | "completed" | "cancelled";

export interface SessionExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  sortOrder: number; // matches the wire-format field used across workouts + sessions
  supersetGroup: number | null;
  sets: ExerciseSet[];
  isSubstituted: boolean;
  originalExerciseId: string | null; // if substituted
}

export interface ExerciseSet {
  id: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null; // 1-10
  distance: number | null;
  duration: number | null; // seconds
  isCompleted: boolean;
  completedAt: string | null;
}

export interface SessionSummary {
  duration: number; // seconds
  totalVolume: number;
  exercisesCompleted: number;
  totalExercises: number;
  setsCompleted: number;
  totalSets: number;
  personalRecords: PersonalRecord[];
}
```

## Domain Services

```typescript
// src/domain/services/sessionService.ts
export function createSessionFromWorkout(workout: Workout): WorkoutSession;
export function createEmptySession(): WorkoutSession;
export function addSetToExercise(
  session: WorkoutSession,
  exerciseId: string,
  set: Partial<ExerciseSet>,
): WorkoutSession;
export function completeSet(
  session: WorkoutSession,
  exerciseId: string,
  setId: string,
): WorkoutSession;
export function substituteExercise(
  session: WorkoutSession,
  oldExerciseId: string,
  newExercise: Exercise,
): WorkoutSession;
export function addExerciseToSession(
  session: WorkoutSession,
  exercise: Exercise,
): WorkoutSession;
export function calculateSummary(session: WorkoutSession): SessionSummary;
export function detectPersonalRecords(
  session: WorkoutSession,
  previousRecords: PersonalRecord[],
): PersonalRecord[];
export function calculateVolume(sets: ExerciseSet[]): number;
```

## State Management

Active session uses a **local-first state machine**:

```
IDLE → ACTIVE → (COMPLETING | CANCELLING) → IDLE
```

State stored in SQLite, not in React state alone. This ensures survival across:

- App backgrounding
- App termination
- Device restart

```typescript
// src/application/commands/session.commands.ts
export class StartSessionCommand {
  /* Creates session in SQLite */
}
export class LogSetCommand {
  /* Updates set in SQLite */
}
export class CompleteSetCommand {
  /* Marks set complete, starts rest timer */
}
export class SubstituteExerciseCommand {
  /* Swaps exercise in SQLite */
}
export class CompleteSessionCommand {
  /* Finalises, calculates summary, queues sync */
}
export class CancelSessionCommand {
  /* Marks cancelled, queues sync */
}
export class ResumeSessionCommand {
  /* Loads active session from SQLite */
}
```

## Rest Timer

```typescript
// src/ui/hooks/useRestTimer.ts
interface RestTimerState {
  isActive: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  progress: number; // 0-1
}

// Uses setInterval for countdown
// Triggers local notification when timer completes (expo-notifications)
// Persists timer state for background survival
```

## UI Components

```
containers/ActiveSessionContainer.tsx      # Session state, set logging, navigation
presenters/ActiveSessionPresenter.tsx      # Full session UI
containers/SessionSummaryContainer.tsx     # Computes summary
presenters/SessionSummaryPresenter.tsx     # Summary display
components/SetLogger.tsx                   # Weight/reps/RPE input row
components/ExerciseProgress.tsx            # Sets completed indicator
components/RestTimerDisplay.tsx            # Countdown ring
components/SessionExerciseCard.tsx         # Exercise with sets
components/SessionHeader.tsx               # Duration, exercise progress
components/QuickFillSuggestion.tsx         # Previous session values
```

## Offline Resilience

This is the most offline-critical feature:

- **Every set logged** writes to SQLite immediately (not batched)
- **Session state** fully recoverable from SQLite alone
- **Sync** happens only on session complete/cancel (one batched flush per session — `createSession` → many `createSessionExercise` → many `createSessionSet` → `updateSession {status: completed|cancelled}`, in dependency order)
- **No network dependency** during workout logging
- **Timer** continues even with no network

### Personal-record detection: hybrid

Decided 2026-05-02 in [`specs/milestones/M3-active-session/BACKEND_BRIEF.md`](../milestones/M3-active-session/BACKEND_BRIEF.md) § "PR-detection decision".

- **Server is canonical.** When `PATCH /sessions/:id` transitions `status` to `completed`, the handler iterates the session's sets, computes `one_rep_max` (Epley: `weightKg × (1 + reps / 30)`) and `volume` (`weightKg × reps`) candidates, and upserts into `personal_records` keyed by `(userId, exerciseId, recordType)` with `ON CONFLICT … DO UPDATE WHERE EXCLUDED.value > personal_records.value`. Idempotent on replay; winning sets are flagged `is_personal_record = true`.
- **Client is predictive.** Mobile maintains an opportunistically-cached `personal_records` slice (synced via `GET /personal-records`) used to (a) populate quick-fill suggestions during set logging, (b) compute the Summary screen's PR list immediately on session complete — even when offline. Server reconciles into the cache after the queued PATCH flushes, picked up by the next focus refresh on the home tab.
- **Why hybrid:** the Summary screen must render fully offline; the `personal_records` table must have a single canonical writer for M4's PR carousel and any downstream analytics.
