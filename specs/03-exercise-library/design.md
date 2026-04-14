# 03 — Exercise Library: Technical Design

## Domain Model

```typescript
// src/domain/models/exercise.ts
export interface Exercise {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  category: ExerciseCategory;
  difficulty: ExerciseDifficulty;
  primaryMuscleGroups: MuscleGroup[];
  secondaryMuscleGroups: MuscleGroup[];
  equipment: EquipmentType[];
  accessibilityTags: AccessibilityTag[];
  isCustom: boolean;
  createdBy: string | null; // userId for custom exercises
}

export type ExerciseCategory =
  | "strength"
  | "cardio"
  | "flexibility"
  | "balance"
  | "plyometric"
  | "olympic"
  | "mobility";
export type ExerciseDifficulty =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "expert";
export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "quadriceps"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core"
  | "forearms"
  | "traps"
  | "lats"
  | "hip_flexors"
  | "abductors"
  | "adductors";
export type EquipmentType =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
  | "kettlebell"
  | "resistance_band"
  | "smith_machine"
  | "ez_bar"
  | "other";

export interface ExerciseFilters {
  search?: string;
  muscleGroups?: MuscleGroup[];
  equipment?: EquipmentType[];
  category?: ExerciseCategory;
  difficulty?: ExerciseDifficulty;
}
```

## Port Extensions

```typescript
// Extends ApiPort
getExercises(filters?: ExerciseFilters, cursor?: string): Promise<Result<PaginatedResult<Exercise>, ApiError>>;
getExercise(id: string): Promise<Result<Exercise, ApiError>>;
createExercise(data: CreateExerciseInput): Promise<Result<Exercise, ApiError>>;

// Extends StoragePort
getCachedExercises(filters?: ExerciseFilters): Promise<Exercise[]>;
cacheExercises(exercises: Exercise[]): Promise<void>;
getExerciseCacheAge(): Promise<Date | null>;
saveCustomExercise(exercise: Exercise): Promise<void>;
```

## Application Layer

```typescript
// src/application/queries/exercises.query.ts
// - Reads from local cache first
// - If online and cache stale (>24h), fetches from API and updates cache
// - Applies filters locally for instant response

// src/application/commands/create-exercise.command.ts
// - Validates input
// - Saves to local storage
// - Queues API sync mutation
```

## UI Layer

```
ui/containers/ExerciseListContainer.tsx    # Fetches, filters, search state
ui/presenters/ExerciseListPresenter.tsx    # Renders list + filters
ui/containers/ExerciseDetailContainer.tsx  # Fetches single exercise
ui/presenters/ExerciseDetailPresenter.tsx  # Renders detail view
ui/containers/ExerciseCreatorContainer.tsx # Form state, validation
ui/presenters/ExerciseCreatorPresenter.tsx # Form UI
ui/components/ExerciseCard.tsx             # List item presenter
ui/components/ExerciseFilterBar.tsx        # Filter chips presenter
ui/components/MuscleGroupPicker.tsx        # Multi-select muscle groups
```

## Offline Strategy

- **Initial sync**: On first launch (or after cache clear), fetch full exercise library
- **Incremental sync**: On subsequent launches, fetch updated exercises since last sync
- **Custom exercises**: Created locally, synced on next online window
- **Cache invalidation**: Stale after 24 hours, refresh in background
- **Search**: Local full-text search on cached name + description fields
