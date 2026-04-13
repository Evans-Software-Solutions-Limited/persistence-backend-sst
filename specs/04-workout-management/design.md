# 04 — Workout Management: Technical Design

## Domain Model

```typescript
// src/domain/models/workout.ts
export interface Workout {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  visibility: WorkoutVisibility;
  estimatedDuration: number | null; // minutes
  exercises: WorkoutExercise[];
  sessionCount: number;
  lastPerformedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  exercise: Exercise; // denormalized for display
  orderIndex: number;
  supersetGroup: number | null; // null = not in superset, same number = same superset
  targetSets: number;
  targetReps: number | null;
  targetWeight: number | null;
  targetDuration: number | null; // seconds, for timed exercises
  notes: string | null;
}

export type WorkoutVisibility = "private" | "friends" | "public";

export interface CreateWorkoutInput {
  name: string;
  description?: string;
  visibility?: WorkoutVisibility;
  exercises: CreateWorkoutExerciseInput[];
}

export interface CreateWorkoutExerciseInput {
  exerciseId: string;
  orderIndex: number;
  supersetGroup?: number;
  targetSets: number;
  targetReps?: number;
  targetWeight?: number;
  targetDuration?: number;
  notes?: string;
}
```

## Domain Services

```typescript
// src/domain/services/workoutService.ts
export function validateWorkout(
  input: CreateWorkoutInput,
): Result<void, ValidationError[]>;
export function calculateEstimatedDuration(
  exercises: WorkoutExercise[],
): number;
export function reorderExercises(
  exercises: WorkoutExercise[],
  fromIndex: number,
  toIndex: number,
): WorkoutExercise[];
export function groupAsSuperSet(
  exercises: WorkoutExercise[],
  exerciseIds: string[],
): WorkoutExercise[];
export function ungroupSuperSet(
  exercises: WorkoutExercise[],
  supersetGroup: number,
): WorkoutExercise[];
```

## Port Extensions

```typescript
// ApiPort additions
getWorkouts(): Promise<Result<Workout[], ApiError>>;
getWorkout(id: string): Promise<Result<Workout, ApiError>>;
createWorkout(data: CreateWorkoutInput): Promise<Result<Workout, ApiError>>;
updateWorkout(id: string, data: Partial<CreateWorkoutInput>): Promise<Result<Workout, ApiError>>;
deleteWorkout(id: string): Promise<Result<void, ApiError>>;

// StoragePort additions
getCachedWorkouts(): Promise<Workout[]>;
cacheWorkouts(workouts: Workout[]): Promise<void>;
saveWorkoutLocally(workout: Workout): Promise<void>;
markWorkoutDeleted(id: string): Promise<void>;
```

## UI Components

```
containers/WorkoutListContainer.tsx        # Fetches workouts, sort state
presenters/WorkoutListPresenter.tsx        # List UI with sort/empty states
containers/WorkoutDetailContainer.tsx      # Fetches single workout
presenters/WorkoutDetailPresenter.tsx      # Detail view with exercises
containers/WorkoutEditorContainer.tsx      # Create/edit form state
presenters/WorkoutEditorPresenter.tsx      # Form UI
components/WorkoutCard.tsx                 # List item
components/WorkoutExerciseRow.tsx          # Exercise in workout
components/SupersetGroup.tsx               # Superset visual grouping
components/ExercisePicker.tsx              # Select exercises modal
components/VisibilitySelector.tsx          # Private/friends/public
```

## Offline Strategy

- **Workouts cached**: Full user workout list stored in SQLite
- **Mutations queued**: Create/edit/delete saved locally, queued for API sync
- **Optimistic UI**: Changes reflected immediately in local cache
- **Conflict**: Server wins on sync (last-write-wins for V1)
