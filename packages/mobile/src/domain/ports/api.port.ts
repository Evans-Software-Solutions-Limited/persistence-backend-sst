import type {
  CreateExerciseInput,
  Exercise,
  ExerciseFilters,
} from "@/domain/models/exercise";
import type {
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type { Result, ApiError } from "@/shared/errors";
import type { PaginatedResult, PaginationParams } from "@/shared/types";

/**
 * Port for remote SST API operations.
 * Implementations: SSTApiAdapter (prod), InMemoryApiAdapter (test).
 *
 * Methods are added per-feature milestone. This initial definition
 * covers the foundation endpoints.
 */
export interface ApiPort {
  /** Health check */
  healthCheck(): Promise<Result<{ status: string }, ApiError>>;

  // -- Profile --
  getProfile(): Promise<Result<ApiProfile, ApiError>>;
  updateProfile(
    data: Partial<ApiProfile>,
  ): Promise<Result<ApiProfile, ApiError>>;

  // -- Workouts --
  getWorkouts(
    params?: PaginationParams,
  ): Promise<Result<ApiWorkout[], ApiError>>;
  getWorkout(id: string): Promise<Result<ApiWorkout, ApiError>>;
  createWorkout(
    data: CreateWorkoutInput,
  ): Promise<Result<ApiWorkout, ApiError>>;
  updateWorkout(
    id: string,
    data: Partial<CreateWorkoutInput>,
  ): Promise<Result<ApiWorkout, ApiError>>;
  deleteWorkout(id: string): Promise<Result<void, ApiError>>;

  // -- Sessions --
  getSessions(
    params?: PaginationParams,
  ): Promise<Result<ApiSession[], ApiError>>;
  getSession(id: string): Promise<Result<ApiSession, ApiError>>;
  createSession(
    data: CreateSessionInput,
  ): Promise<Result<ApiSession, ApiError>>;
  updateSession(
    id: string,
    data: UpdateSessionInput,
  ): Promise<Result<ApiSession, ApiError>>;
  deleteSession(id: string): Promise<Result<void, ApiError>>;

  // -- Exercises --
  getExercises(
    filters?: ExerciseFilters,
    offset?: number,
    limit?: number,
  ): Promise<Result<PaginatedResult<Exercise>, ApiError>>;
  getExercise(id: string): Promise<Result<Exercise, ApiError>>;
  createExercise(
    data: CreateExerciseInput,
  ): Promise<Result<Exercise, ApiError>>;
  updateExercise(
    id: string,
    data: Partial<CreateExerciseInput>,
  ): Promise<Result<Exercise, ApiError>>;
  deleteExercise(id: string): Promise<Result<void, ApiError>>;

  /**
   * Fetch a reference-list catalog (muscle groups / equipment / categories)
   * from the backend. Returns `ReferenceEntry[]` — the ApiPort does NOT
   * hold onto the list; the StoragePort caches it separately.
   *
   * Spec: design.md § Reference-List Cache > Port extensions · AC 7.10
   */
  getReferenceList(
    kind: ReferenceListKind,
  ): Promise<Result<ReferenceEntry[], ApiError>>;

  // -- Sets --
  createSet(
    sessionId: string,
    exerciseId: string,
    data: CreateSetInput,
  ): Promise<Result<ApiExerciseSet, ApiError>>;
  updateSet(
    sessionId: string,
    exerciseId: string,
    setId: string,
    data: Partial<CreateSetInput>,
  ): Promise<Result<ApiExerciseSet, ApiError>>;
  deleteSet(
    sessionId: string,
    exerciseId: string,
    setId: string,
  ): Promise<Result<void, ApiError>>;

  // -- Goals --
  getGoals(params?: PaginationParams): Promise<Result<ApiGoal[], ApiError>>;
  getGoal(id: string): Promise<Result<ApiGoal, ApiError>>;
  createGoal(data: CreateGoalInput): Promise<Result<ApiGoal, ApiError>>;
  updateGoal(
    id: string,
    data: Partial<CreateGoalInput>,
  ): Promise<Result<ApiGoal, ApiError>>;
  deleteGoal(id: string): Promise<Result<void, ApiError>>;
}

// -- API data shapes (mirror backend response types) --

export type ApiProfile = {
  id: string;
  email: string;
  fullName: string | null;
  role: "user" | "personal_trainer" | "physiotherapist" | "admin";
  fitnessLevel: "beginner" | "intermediate" | "advanced" | "elite" | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiWorkout = {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  visibility: "private" | "friends" | "public";
  estimatedDurationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiSession = {
  id: string;
  userId: string;
  workoutId: string | null;
  name: string | null;
  status: "in_progress" | "completed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  totalDurationSeconds: number | null;
  userNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiExercise = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  category: string;
  difficultyLevel: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipmentRequired: string[];
  /** Added M0. Backend emits these on GET /exercises and GET /exercises/:id. */
  videoUrl: string | null;
  thumbnailUrl: string | null;
  /**
   * Present on some backend responses (pre-M0) but no longer set by
   * the M0 backend — it derives isCustom client-side from `createdBy
   * !== null`. Kept optional on the wire type so adapters stay
   * tolerant of either shape during the transition.
   */
  isCustom?: boolean;
  createdBy: string | null;
};

export type ApiExerciseSet = {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  isPersonalRecord: boolean;
};

export type ApiGoal = {
  id: string;
  userId: string;
  goalTypeId: string;
  priority: number | null;
  targetDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// -- Input types --

export type CreateWorkoutInput = {
  name: string;
  description?: string;
  visibility?: "private" | "friends" | "public";
};

export type CreateSessionInput = {
  workoutId?: string;
  name?: string;
  status?: "in_progress" | "completed" | "cancelled";
  userNotes?: string;
};

export type UpdateSessionInput = {
  status?: "in_progress" | "completed" | "cancelled";
  userNotes?: string;
  sessionRating?: number;
  overallRpe?: number;
};

export type CreateSetInput = {
  setNumber: number;
  reps?: number;
  weightKg?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  rpe?: number;
};

export type CreateGoalInput = {
  goalTypeId: string;
  priority?: number;
  targetDate?: string;
};
