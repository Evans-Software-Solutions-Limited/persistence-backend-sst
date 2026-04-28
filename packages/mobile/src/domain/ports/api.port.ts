import type { DashboardPayload } from "@/domain/models/dashboard";
import type {
  CreateExerciseInput,
  Exercise,
  ExerciseFilters,
} from "@/domain/models/exercise";
import type {
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type {
  CreateWorkoutInput as CreateWorkoutDomainInput,
  UpdateWorkoutInput as UpdateWorkoutDomainInput,
  Workout,
  WorkoutListType,
  WorkoutQuota,
} from "@/domain/models/workout";
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

  // -- Workouts (M2) --
  /**
   * Fetch a workouts list slice for one of the three section types
   * (mine / assigned / default). The double-envelope response carries
   * pagination metadata and (for `type=mine` only) a `quota` block.
   *
   * Spec: specs/04-workout-management/design.md § API Contract > GET /workouts
   */
  getWorkouts(
    params?: GetWorkoutsParams,
  ): Promise<Result<GetWorkoutsResult, ApiError>>;
  getWorkout(id: string): Promise<Result<Workout, ApiError>>;
  createWorkout(
    data: CreateWorkoutDomainInput,
  ): Promise<Result<Workout, ApiError>>;
  updateWorkout(
    id: string,
    data: UpdateWorkoutDomainInput,
  ): Promise<Result<Workout, ApiError>>;
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

  /**
   * Seed the adapter's in-memory id→label + name→id reference-list
   * lookups from a previously-cached set of entries (typically loaded
   * from StoragePort at app start). Normally the adapter populates
   * these maps lazily inside `getReferenceList`; this lets a caller
   * prime them without hitting the network so that `getExercises`
   * responses can be enriched with muscle / equipment labels even on
   * cold cache + second-launch paths where no reference-list fetch
   * fires. Safe to call repeatedly; replaces the existing entries.
   */
  hydrateReferenceLabels(
    kind: ReferenceListKind,
    entries: readonly ReferenceEntry[],
  ): void;

  /**
   * Apply the adapter's cached reference-list lookups to an Exercise,
   * stamping `primaryMuscleGroupLabels` / `secondaryMuscleGroupLabels` /
   * `equipmentLabels`. Pure — does not touch storage or network. Safe
   * no-op if the lookups aren't hydrated yet (labels come back empty).
   */
  enrichExerciseLabels(exercise: Exercise): Exercise;

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

  /**
   * Fetch the Home-tab dashboard aggregation payload (M1).
   *
   * Single-envelope response (`{ data: DashboardPayload }`) — adapter
   * unwraps once. No UUID-typed fields on the payload, so no
   * reference-list enrichment is required.
   *
   * Spec: specs/06-progress-goals/design.md § Dashboard backend contract (M1)
   *       specs/06-progress-goals/requirements.md STORY-005 AC 5.8, STORY-007 AC 7.1
   */
  getDashboard(): Promise<Result<DashboardPayload, ApiError>>;

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

/**
 * Wire shape for a workout. The M2 backend emits camelCase via Drizzle,
 * so `ApiWorkout` and the domain `Workout` model are structurally
 * identical — the adapter passes payloads through without mapping.
 */
export type ApiWorkout = Workout;

/** M2: query params for the GET /workouts list endpoint. */
export type GetWorkoutsParams = {
  type?: WorkoutListType;
  limit?: number;
  offset?: number;
};

/**
 * M2: list response. Mirrors the backend's double-envelope `{ data, meta }`
 * after the adapter unwraps once. `quota` is only present when the
 * request was for `type='mine'`; absent for `assigned` / `default`.
 */
export type GetWorkoutsResult = {
  workouts: Workout[];
  total: number;
  quota: WorkoutQuota | null;
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
// `CreateWorkoutInput` and `UpdateWorkoutInput` are imported from
// `@/domain/models/workout` (re-exported as `CreateWorkoutDomainInput` /
// `UpdateWorkoutDomainInput`) so the form layer and the API layer share
// one canonical definition.

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
