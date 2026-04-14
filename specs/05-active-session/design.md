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
  orderIndex: number;
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
- **Sync** happens only on session complete/cancel (one API call per session)
- **No network dependency** during workout logging
- **Timer** continues even with no network
